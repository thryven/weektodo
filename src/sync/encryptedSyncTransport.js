import { decryptPayload, encryptPayload } from "./crypto";

function associatedData(workspaceId, operation) {
  return `weektodo:v1:${workspaceId}:${operation.entityType}:${operation.entityId}`;
}

export class EncryptedSyncTransport {
  constructor({ transport, accountKeyProvider }) {
    this.transport = transport;
    this.accountKeyProvider = accountKeyProvider;
  }

  async push(envelope) {
    const key = await this.accountKeyProvider();
    const operations = await Promise.all(envelope.operations.map(async (operation) => {const wire={...operation};delete wire.basePayload;
      return {...wire,payload:await encryptPayload(key,operation.payload,associatedData(envelope.workspaceId,operation))};}));
    const response=await this.transport.push({ ...envelope, operations });
    const conflicts=await Promise.all((response.conflicts||[]).map(async(conflict)=>({...conflict,
      serverPayload:conflict.serverPayload ? await decryptPayload(key,conflict.serverPayload,
        associatedData(envelope.workspaceId,conflict)) : null})));
    return {...response,conflicts};
  }

  async pull(request) {
    const response = await this.transport.pull(request);
    const key = await this.accountKeyProvider();
    const changes = await Promise.all(response.changes.map(async (change) => {
      const payload = await decryptPayload(key, change.payload, associatedData(request.workspaceId, change));
      if (payload._sync) payload._sync.serverRevision = change.serverRevision;
      return { ...change, payload };
    }));
    return { ...response, changes };
  }
}
