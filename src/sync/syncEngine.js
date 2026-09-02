import { compactOutbox, readyOperations } from "./outbox";
import { createPushEnvelope, SYNC_BATCH_LIMIT, SYNC_PROTOCOL_VERSION } from "./protocol";
import { resolveConflict } from "./conflictResolver";

export class SyncEngine {
  constructor({ transport, storage, workspaceId, deviceId, now = Date.now }) {
    this.transport = transport;
    this.storage = storage;
    this.workspaceId = workspaceId;
    this.deviceId = deviceId;
    this.now = now;
  }

  async initialize() {
    await this.storage.pruneTombstones?.(new Date(this.now()).toISOString());
    return this.storage.setMetadata("profile", { protocolVersion: SYNC_PROTOCOL_VERSION, workspaceId: this.workspaceId,
      deviceId: this.deviceId, enabled: true });
  }

  async pullAll() {
    let cursor = (await this.storage.getMetadata("cursor")) || 0;
    let hasMore = true;
    while (hasMore) {
      const page = await this.transport.pull({ workspaceId: this.workspaceId, cursor, limit: SYNC_BATCH_LIMIT });
      if (page.changes.length) await this.storage.applyChanges(page.changes);
      cursor = page.nextCursor;
      await this.storage.setMetadata("cursor", cursor);
      hasMore = page.hasMore;
    }
    return cursor;
  }

  async synchronize() {
    await this.pullAll();
    const pending = readyOperations(await this.storage.loadOutbox(), this.now());
    const compacted = compactOutbox(pending);
    if (compacted.supersededOperationIds.length) await this.storage.acknowledge(compacted.supersededOperationIds);
    const batch = compacted.operations.slice(0, SYNC_BATCH_LIMIT);

    let conflicts = [];
    if (batch.length) {
      try {
        const response = await this.transport.push(createPushEnvelope({ workspaceId: this.workspaceId,
          deviceId: this.deviceId, operations: batch }));
        await this.storage.acknowledge(response.acknowledgedOperationIds);
        conflicts = response.conflicts;
        if(conflicts.length){const byId=new Map(batch.map((operation)=>[operation.operationId,operation]));
          const resolutions=conflicts.map((conflict)=>{const operation=byId.get(conflict.operationId);
            const resolved=resolveConflict(operation,conflict,{deviceId:this.deviceId,now:()=>new Date(this.now()).toISOString()});
            return {...resolved,operationId:operation.operationId,record:{id:crypto.randomUUID(),entityKey:`${operation.entityType}:${operation.entityId}`,
              entityType:operation.entityType,entityId:operation.entityId,operationId:operation.operationId,fields:resolved.conflictFields,
              conflictCopyId:resolved.conflictCopy?._sync?.id||null,serverRevision:conflict.serverRevision,
              createdAt:new Date(this.now()).toISOString(),resolvedAt:null}};});
          await this.storage.resolveConflicts(resolutions);}
        await this.storage.setMetadata("conflicts", conflicts);
      } catch (error) {
        await this.storage.markFailed(batch, error, this.now());
        throw error;
      }
    }
    const cursor = await this.pullAll();
    const lastSuccessAt=new Date(this.now()).toISOString();await this.storage.setMetadata("lastSuccessfulSyncAt",lastSuccessAt);
    return { cursor, conflicts,lastSuccessAt };
  }
}
