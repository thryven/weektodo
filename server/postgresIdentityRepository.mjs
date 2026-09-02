export class PostgresIdentityRepository {
  constructor(pool) { this.pool = pool; }
  async createAccount(a) {
    await this.pool.query(`INSERT INTO accounts(id,email,password_hash,password_key_envelope,recovery_key_envelope,verified_at,
      verification_token_hash,verification_expires_at,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [a.id,a.email,a.passwordHash,a.passwordKeyEnvelope,a.recoveryKeyEnvelope,a.verifiedAt,a.verificationTokenHash,
        a.verificationExpiresAt,a.createdAt]);
    await this.pool.query("INSERT INTO sync_state(workspace_id) VALUES($1) ON CONFLICT DO NOTHING", [a.id]); return a;
  }
  async accountByEmail(email) { const { rows } = await this.pool.query("SELECT * FROM accounts WHERE email=$1", [email]); return mapAccount(rows[0]); }
  async accountById(id) { const { rows } = await this.pool.query("SELECT * FROM accounts WHERE id=$1", [id]); return mapAccount(rows[0]); }
  async accountByVerificationHash(hash) { const {rows}=await this.pool.query("SELECT * FROM accounts WHERE verification_token_hash=$1",[hash]);
    return mapAccount(rows[0]); }
  async markAccountVerified(id,at) { await this.pool.query(`UPDATE accounts SET verified_at=$2,verification_token_hash=NULL,
    verification_expires_at=NULL WHERE id=$1`,[id,at]); }
  async updateVerification(id,hash,expiresAt) { await this.pool.query(`UPDATE accounts SET verification_token_hash=$2,
    verification_expires_at=$3 WHERE id=$1 AND verified_at IS NULL`,[id,hash,expiresAt]); }
  async saveDevice(d) { await this.pool.query("INSERT INTO devices(id,account_id,name,created_at,revoked_at) VALUES($1,$2,$3,$4,$5)",
    [d.id,d.accountId,d.name,d.createdAt,d.revokedAt]); return d; }
  async device(id) { const { rows } = await this.pool.query("SELECT * FROM devices WHERE id=$1", [id]); return mapDevice(rows[0]); }
  async devicesForAccount(id) { const { rows } = await this.pool.query("SELECT * FROM devices WHERE account_id=$1 ORDER BY created_at", [id]); return rows.map(mapDevice); }
  async saveSession(s) { await this.pool.query(`INSERT INTO sessions(refresh_hash,access_hash,account_id,device_id,access_expires_at,
    refresh_expires_at,revoked_at) VALUES($1,$2,$3,$4,$5,$6,$7)`, [s.refreshHash,s.accessHash,s.accountId,s.deviceId,
    s.accessExpiresAt,s.refreshExpiresAt,s.revokedAt]); return s; }
  async sessionByRefreshHash(hash) { const { rows } = await this.pool.query("SELECT * FROM sessions WHERE refresh_hash=$1", [hash]); return mapSession(rows[0]); }
  async sessionByAccessHash(hash) { const { rows } = await this.pool.query("SELECT * FROM sessions WHERE access_hash=$1 AND revoked_at IS NULL", [hash]); return mapSession(rows[0]); }
  async revokeSession(hash, at) { await this.pool.query("UPDATE sessions SET revoked_at=$2 WHERE refresh_hash=$1", [hash,at]); }
  async rotateSession(hash,next,now,at) { const client=await this.pool.connect();try{await client.query("BEGIN");
    const {rows}=await client.query("SELECT * FROM sessions WHERE refresh_hash=$1 FOR UPDATE",[hash]);const current=mapSession(rows[0]);
    if(!current){await client.query("ROLLBACK");return {status:"invalid"};}
    if(current.revokedAt){await client.query("UPDATE sessions SET revoked_at=$2 WHERE device_id=$1",[current.deviceId,at]);
      await client.query("COMMIT");return {status:"replay"};}
    if(current.refreshExpiresAt<=now){await client.query("ROLLBACK");return {status:"invalid"};}
    await client.query("UPDATE sessions SET revoked_at=$2 WHERE refresh_hash=$1",[hash,at]);
    await client.query(`INSERT INTO sessions(refresh_hash,access_hash,account_id,device_id,access_expires_at,refresh_expires_at,revoked_at)
      VALUES($1,$2,$3,$4,$5,$6,$7)`,[next.refreshHash,next.accessHash,next.accountId,next.deviceId,next.accessExpiresAt,
      next.refreshExpiresAt,next.revokedAt]);await client.query("COMMIT");return {status:"rotated"};
  }catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();} }
  async revokeSessionsForDevice(id,at) { await this.pool.query("UPDATE sessions SET revoked_at=$2 WHERE device_id=$1",[id,at]); }
  async revokeDevice(id, at) { const client = await this.pool.connect(); try { await client.query("BEGIN");
    await client.query("UPDATE devices SET revoked_at=$2 WHERE id=$1", [id,at]);
    await client.query("UPDATE sessions SET revoked_at=$2 WHERE device_id=$1", [id,at]); await client.query("COMMIT"); }
    catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); } }
  async saveEnrollment(e) { await this.pool.query(`INSERT INTO device_enrollments(id,account_id,secret_hash,approval_code,device_name,
    expires_at,approved_at,completed_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`, [e.id,e.accountId,e.secretHash,e.approvalCode,
    e.deviceName,e.expiresAt,e.approvedAt,e.completedAt]); return e; }
  async enrollment(id) { const { rows } = await this.pool.query("SELECT * FROM device_enrollments WHERE id=$1", [id]); return mapEnrollment(rows[0]); }
  async pendingEnrollments(id) { const { rows } = await this.pool.query(`SELECT * FROM device_enrollments WHERE account_id=$1
    AND completed_at IS NULL ORDER BY expires_at`, [id]); return rows.map(mapEnrollment); }
  async updateEnrollment(e) { await this.pool.query("UPDATE device_enrollments SET approved_at=$2,completed_at=$3 WHERE id=$1",
    [e.id,e.approvedAt,e.completedAt]); return e; }
}
const mapAccount = (r) => r && ({ id:r.id,email:r.email,passwordHash:r.password_hash,passwordKeyEnvelope:r.password_key_envelope,
  recoveryKeyEnvelope:r.recovery_key_envelope,verifiedAt:r.verified_at,verificationTokenHash:r.verification_token_hash,
  verificationExpiresAt:r.verification_expires_at == null ? null : Number(r.verification_expires_at),createdAt:r.created_at });
const mapDevice = (r) => r && ({ id:r.id,accountId:r.account_id,name:r.name,createdAt:r.created_at,revokedAt:r.revoked_at });
const mapSession = (r) => r && ({ refreshHash:r.refresh_hash,accessHash:r.access_hash,accountId:r.account_id,deviceId:r.device_id,
  accessExpiresAt:Number(r.access_expires_at),refreshExpiresAt:Number(r.refresh_expires_at),revokedAt:r.revoked_at });
const mapEnrollment = (r) => r && ({ id:r.id,accountId:r.account_id,secretHash:r.secret_hash,approvalCode:r.approval_code,
  deviceName:r.device_name,expiresAt:Number(r.expires_at),approvedAt:r.approved_at,completedAt:r.completed_at });
