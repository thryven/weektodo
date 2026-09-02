import { assertSyncEnvelope } from "../src/sync/protocol.js";

export class PostgresSyncServer {
  constructor(pool) { this.pool = pool; }
  async push(envelope) {
    assertSyncEnvelope(envelope); const client = await this.pool.connect();
    const acknowledgedOperationIds = []; const conflicts = [];
    try {
      await client.query("BEGIN");
      await client.query("INSERT INTO sync_state(workspace_id) VALUES($1) ON CONFLICT DO NOTHING", [envelope.workspaceId]);
      const state = await client.query("SELECT revision FROM sync_state WHERE workspace_id=$1 FOR UPDATE", [envelope.workspaceId]);
      let revision = Number(state.rows[0].revision);
      for (const operation of envelope.operations) {
        const replay = await client.query("SELECT 1 FROM sync_changes WHERE workspace_id=$1 AND operation_id=$2", [envelope.workspaceId,operation.operationId]);
        if (replay.rowCount) { acknowledgedOperationIds.push(operation.operationId); continue; }
        const existing = await client.query(`SELECT server_revision,payload,action FROM sync_entities WHERE workspace_id=$1 AND entity_type=$2
          AND entity_id=$3`, [envelope.workspaceId,operation.entityType,operation.entityId]);
        if(!existing.rowCount){const marker=await client.query(`SELECT server_revision FROM sync_tombstones WHERE workspace_id=$1
          AND entity_type=$2 AND entity_id=$3`,[envelope.workspaceId,operation.entityType,operation.entityId]);
          if(marker.rowCount&&operation.baseRevision<Number(marker.rows[0].server_revision)){conflicts.push({operationId:operation.operationId,
            entityType:operation.entityType,entityId:operation.entityId,serverRevision:Number(marker.rows[0].server_revision),
            serverAction:"delete",serverPayload:null});continue;}}
        if (existing.rowCount && Number(existing.rows[0].server_revision) !== operation.baseRevision) {
          conflicts.push({ operationId:operation.operationId,entityType:operation.entityType,entityId:operation.entityId,
            serverRevision:Number(existing.rows[0].server_revision),serverAction:existing.rows[0].action,
            serverPayload:existing.rows[0].payload }); continue;
        }
        revision += 1;
        const deletedAt=operation.action==="delete"?new Date().toISOString():null;
        await client.query(`INSERT INTO sync_entities(workspace_id,entity_type,entity_id,server_revision,payload,action,deleted_at)
          VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(workspace_id,entity_type,entity_id) DO UPDATE SET
          server_revision=EXCLUDED.server_revision,payload=EXCLUDED.payload,action=EXCLUDED.action,deleted_at=EXCLUDED.deleted_at`,
          [envelope.workspaceId,operation.entityType,operation.entityId,revision,operation.payload,operation.action,deletedAt]);
        if(operation.action==="delete")await client.query(`INSERT INTO sync_tombstones(workspace_id,entity_type,entity_id,server_revision,deleted_at)
          VALUES($1,$2,$3,$4,$5) ON CONFLICT(workspace_id,entity_type,entity_id) DO UPDATE SET
          server_revision=EXCLUDED.server_revision,deleted_at=EXCLUDED.deleted_at`,[envelope.workspaceId,operation.entityType,
          operation.entityId,revision,deletedAt]);
        else await client.query("DELETE FROM sync_tombstones WHERE workspace_id=$1 AND entity_type=$2 AND entity_id=$3",
          [envelope.workspaceId,operation.entityType,operation.entityId]);
        await client.query(`INSERT INTO sync_changes(workspace_id,server_revision,operation_id,device_id,entity_type,entity_id,action,payload)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8)`, [envelope.workspaceId,revision,operation.operationId,envelope.deviceId,
          operation.entityType,operation.entityId,operation.action,operation.payload]);
        acknowledgedOperationIds.push(operation.operationId);
      }
      await client.query("UPDATE sync_state SET revision=$2 WHERE workspace_id=$1", [envelope.workspaceId,revision]);
      await client.query("COMMIT"); return { acknowledgedOperationIds, conflicts, serverCursor: revision };
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  }
  async pull({ workspaceId, cursor = 0, limit = 500,deviceId }) {
    if(deviceId)await this.pool.query(`INSERT INTO sync_device_cursors(workspace_id,device_id,cursor) VALUES($1,$2,$3)
      ON CONFLICT(workspace_id,device_id) DO UPDATE SET cursor=GREATEST(sync_device_cursors.cursor,EXCLUDED.cursor),updated_at=now()`,
      [workspaceId,deviceId,cursor]);
    const { rows } = await this.pool.query(`SELECT server_revision,operation_id,device_id,entity_type,entity_id,action,payload
      FROM sync_changes WHERE workspace_id=$1 AND server_revision>$2 ORDER BY server_revision LIMIT $3`, [workspaceId,cursor,limit]);
    const changes = rows.map((r) => ({ serverRevision:Number(r.server_revision),operationId:r.operation_id,deviceId:r.device_id,
      entityType:r.entity_type,entityId:r.entity_id,action:r.action,payload:r.payload }));
    const state = await this.pool.query("SELECT revision FROM sync_state WHERE workspace_id=$1", [workspaceId]);
    const revision = Number(state.rows[0]?.revision || 0); const nextCursor = changes.at(-1)?.serverRevision || cursor;
    return { changes, nextCursor, hasMore: nextCursor < revision };
  }
}
