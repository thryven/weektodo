import { SYNC_BATCH_LIMIT, assertSyncEnvelope } from "./protocol.js";

export class InMemorySyncServer {
  constructor() {
    this.workspaces = new Map();
  }

  workspace(id) {
    if (!this.workspaces.has(id)) {
      this.workspaces.set(id, { revision: 0, changes: [], entities: new Map(), tombstones:new Map(),processed: new Map(),deviceCursors:new Map() });
    }
    return this.workspaces.get(id);
  }

  async push(envelope) {
    assertSyncEnvelope(envelope);
    const workspace = this.workspace(envelope.workspaceId);
    const acknowledgedOperationIds = [];
    const conflicts = [];

    for (const operation of envelope.operations) {
      if (workspace.processed.has(operation.operationId)) {
        acknowledgedOperationIds.push(operation.operationId);
        continue;
      }
      const key = `${operation.entityType}:${operation.entityId}`;
      const existing = workspace.entities.get(key);
      const marker=workspace.tombstones.get(key);
      if(!existing&&marker&&operation.baseRevision<marker.serverRevision){conflicts.push({operationId:operation.operationId,
        entityType:operation.entityType,entityId:operation.entityId,serverRevision:marker.serverRevision,serverAction:"delete",serverPayload:null});continue;}
      if (existing && operation.baseRevision !== existing.serverRevision) {
        conflicts.push({ operationId: operation.operationId, entityType: operation.entityType, entityId: operation.entityId,
          serverRevision: existing.serverRevision,serverAction:existing.action,serverPayload: existing.payload });
        continue;
      }

      workspace.revision += 1;
      const payload = structuredClone(operation.payload);
      if (payload._sync) payload._sync.serverRevision = workspace.revision;
      const change = { ...structuredClone(operation), payload, serverRevision: workspace.revision };
      workspace.entities.set(key, { serverRevision: workspace.revision,action:operation.action,payload,
        deletedAt:operation.action==="delete"?new Date().toISOString():null });
      if(operation.action==="delete")workspace.tombstones.set(key,{serverRevision:workspace.revision,deletedAt:new Date().toISOString()});
      else workspace.tombstones.delete(key);
      workspace.changes.push(change);
      workspace.processed.set(operation.operationId, workspace.revision);
      acknowledgedOperationIds.push(operation.operationId);
    }
    return { acknowledgedOperationIds, conflicts, serverCursor: workspace.revision };
  }

  async pull({ workspaceId, cursor = 0, limit = SYNC_BATCH_LIMIT,deviceId }) {
    const workspace = this.workspace(workspaceId);
    if(deviceId)workspace.deviceCursors.set(deviceId,cursor);
    const changes = workspace.changes.filter((change) => change.serverRevision > cursor).slice(0, limit);
    const nextCursor = changes.at(-1)?.serverRevision ?? cursor;
    return { changes: structuredClone(changes), nextCursor, hasMore: nextCursor < workspace.revision };
  }
  archiveTombstonePayloads(before) { for(const workspace of this.workspaces.values())for(const [key,entity] of workspace.entities)
    if(entity.action==="delete"&&entity.deletedAt<before)workspace.entities.delete(key); }
}
