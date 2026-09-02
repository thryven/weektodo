import process from "node:process";
import { Pool } from "pg";
import { fileURLToPath } from "node:url";

export async function runMaintenance(pool,{auditRetentionDays=90,sessionRetentionDays=30,tombstonePayloadRetentionDays=90}={}) {
  const client=await pool.connect();try{await client.query("BEGIN");
    const audit=await client.query("DELETE FROM security_audit_events WHERE created_at < now() - ($1 * interval '1 day')",
      [auditRetentionDays]);
    const sessions=await client.query(`DELETE FROM sessions WHERE refresh_expires_at < $1 OR
      (revoked_at IS NOT NULL AND revoked_at < now() - ($2 * interval '1 day'))`,[Date.now(),sessionRetentionDays]);
    const enrollments=await client.query("DELETE FROM device_enrollments WHERE expires_at < $1",[Date.now()]);
    const tombstones=await client.query(`DELETE FROM sync_entities entity WHERE entity.action='delete'
      AND entity.deleted_at < now() - ($1 * interval '1 day') AND EXISTS (
        SELECT 1 FROM sync_tombstones marker WHERE marker.workspace_id=entity.workspace_id AND marker.entity_type=entity.entity_type
          AND marker.entity_id=entity.entity_id AND marker.server_revision=entity.server_revision)`,[tombstonePayloadRetentionDays]);
    await client.query("COMMIT");return {auditEventsDeleted:audit.rowCount,sessionsDeleted:sessions.rowCount,
      enrollmentsDeleted:enrollments.rowCount,tombstonePayloadsArchived:tombstones.rowCount};
  }catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}
}

if(process.argv[1]===fileURLToPath(import.meta.url)){
  if(!process.env.DATABASE_URL)throw new Error("DATABASE_URL is required");const pool=new Pool({connectionString:process.env.DATABASE_URL,
    ssl:process.env.DATABASE_SSL==="true"?{rejectUnauthorized:process.env.DATABASE_SSL_REJECT_UNAUTHORIZED!=="false"}:false});
  try{const result=await runMaintenance(pool,{auditRetentionDays:Number(process.env.AUDIT_RETENTION_DAYS||90),
    sessionRetentionDays:Number(process.env.SESSION_RETENTION_DAYS||30),tombstonePayloadRetentionDays:
      Number(process.env.TOMBSTONE_PAYLOAD_RETENTION_DAYS||90)});process.stdout.write(`${JSON.stringify(result)}\n`);}finally{await pool.end();}
}
