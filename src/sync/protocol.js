export const SYNC_PROTOCOL_VERSION = 1;
export const SYNC_BATCH_LIMIT = 500;

export function assertSyncEnvelope(envelope) {
  if (envelope?.protocolVersion !== SYNC_PROTOCOL_VERSION) throw new Error("Unsupported sync protocol version");
  if (!envelope.workspaceId || !envelope.deviceId) throw new Error("Sync workspace and device are required");
  return envelope;
}

export function createPushEnvelope({ workspaceId, deviceId, operations }) {
  if (!Array.isArray(operations) || operations.length > SYNC_BATCH_LIMIT) throw new Error("Invalid sync operation batch");
  return assertSyncEnvelope({ protocolVersion: SYNC_PROTOCOL_VERSION, workspaceId, deviceId, operations });
}
