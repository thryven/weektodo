export class InMemoryIdentityRepository {
  constructor() { this.accounts = new Map(); this.emails = new Map(); this.devices = new Map(); this.sessions = new Map(); this.enrollments = new Map(); }
  async createAccount(account) {
    if (this.emails.has(account.email)) throw new Error("ACCOUNT_EXISTS");
    this.accounts.set(account.id, structuredClone(account)); this.emails.set(account.email, account.id); return account;
  }
  async accountByEmail(email) { return structuredClone(this.accounts.get(this.emails.get(email)) || null); }
  async accountById(id) { return structuredClone(this.accounts.get(id) || null); }
  async accountByVerificationHash(hash) { return structuredClone([...this.accounts.values()].find((item)=>item.verificationTokenHash===hash)||null); }
  async markAccountVerified(id, at) { const account=this.accounts.get(id);account.verifiedAt=at;account.verificationTokenHash=null;
    account.verificationExpiresAt=null; }
  async updateVerification(id, hash, expiresAt) { const account=this.accounts.get(id); if (!account) return;
    account.verificationTokenHash=hash;account.verificationExpiresAt=expiresAt; }
  async saveDevice(device) { this.devices.set(device.id, structuredClone(device)); return device; }
  async device(id) { return structuredClone(this.devices.get(id) || null); }
  async devicesForAccount(accountId) {
    return [...this.devices.values()].filter((item) => item.accountId === accountId).map((item) => structuredClone(item));
  }
  async saveSession(session) { this.sessions.set(session.refreshHash, structuredClone(session)); return session; }
  async sessionByRefreshHash(hash) { return structuredClone(this.sessions.get(hash) || null); }
  async sessionByAccessHash(hash) {
    const found = [...this.sessions.values()].find((session) => session.accessHash === hash && !session.revokedAt);
    return structuredClone(found || null);
  }
  async revokeSession(refreshHash, at) { const session = this.sessions.get(refreshHash); if (session) session.revokedAt = at; }
  async rotateSession(refreshHash,newSession,now,at) { const session=this.sessions.get(refreshHash);
    if(!session)return {status:"invalid"};
    if(session.revokedAt){await this.revokeSessionsForDevice(session.deviceId,at);return {status:"replay"};}
    if(session.refreshExpiresAt<=now)return {status:"invalid"};session.revokedAt=at;this.sessions.set(newSession.refreshHash,structuredClone(newSession));
    return {status:"rotated"}; }
  async revokeSessionsForDevice(deviceId,at) { for(const session of this.sessions.values())if(session.deviceId===deviceId)session.revokedAt=at; }
  async revokeDevice(deviceId, at) {
    const device = this.devices.get(deviceId); if (device) device.revokedAt = at;
    await this.revokeSessionsForDevice(deviceId,at);
  }
  async saveEnrollment(enrollment) { this.enrollments.set(enrollment.id, structuredClone(enrollment)); return enrollment; }
  async enrollment(id) { return structuredClone(this.enrollments.get(id) || null); }
  async pendingEnrollments(accountId) { return [...this.enrollments.values()].filter((item) => item.accountId === accountId && !item.completedAt)
    .map((item) => structuredClone(item)); }
  async updateEnrollment(enrollment) { this.enrollments.set(enrollment.id, structuredClone(enrollment)); return enrollment; }
}
