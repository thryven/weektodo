import { createHmac } from "node:crypto";

export function hashNetworkAddress(address, secret) {
  if (!address || !secret) return null;
  return createHmac("sha256", secret).update(String(address)).digest("base64url");
}

export class InMemoryAuditRepository {
  constructor() { this.events = []; }
  async record(event) { this.events.push(structuredClone(event)); }
}

export class PostgresAuditRepository {
  constructor(pool) { this.pool = pool; }
  async record(event) {
    await this.pool.query(`INSERT INTO security_audit_events(account_id,device_id,event_type,outcome,ip_hash,created_at)
      VALUES($1,$2,$3,$4,$5,$6)`, [event.accountId, event.deviceId, event.eventType, event.outcome, event.ipHash, event.createdAt]);
  }
}
