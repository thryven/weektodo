import { createApprovalCode, createOpaqueToken, normalizeEmail, passwordHasher, randomUUID, tokenHash } from "./security.mjs";

const ACCESS_LIFETIME = 15 * 60 * 1000;
const REFRESH_LIFETIME = 30 * 24 * 60 * 60 * 1000;

export class AuthService {
  constructor({ repository, hasher = passwordHasher, now = Date.now, verificationSender = { send: async () => {} },
    requireVerification = true }) {
    this.repository = repository; this.hasher = hasher; this.now = now;this.verificationSender=verificationSender;
    this.requireVerification=requireVerification;
  }
  async register({ email, password, passwordKeyEnvelope, recoveryKeyEnvelope }) {
    if (String(password).length < 12) throw new Error("WEAK_PASSWORD");
    const verificationToken=createOpaqueToken();
    const account = { id: randomUUID(), email: normalizeEmail(email), passwordHash: await this.hasher.hash(password),
      passwordKeyEnvelope, recoveryKeyEnvelope, verifiedAt: null,verificationTokenHash:tokenHash(verificationToken),
      verificationExpiresAt:this.now()+24*60*60*1000,createdAt: new Date(this.now()).toISOString() };
    await this.repository.createAccount(account);
    await this.verificationSender.send({email:account.email,token:verificationToken});
    return { id: account.id, email: account.email };
  }
  async login({ email, password, deviceName, deviceId }) {
    const account = await this.repository.accountByEmail(normalizeEmail(email));
    if (!account || !(await this.hasher.verify(account.passwordHash, password))) throw new Error("INVALID_CREDENTIALS");
    if(this.requireVerification&&!account.verifiedAt) throw new Error("EMAIL_NOT_VERIFIED");
    let device = deviceId ? await this.repository.device(deviceId) : null;
    if (device && (device.accountId !== account.id || device.revokedAt)) throw new Error("DEVICE_REVOKED");
    if (!device) {
      const existingDevices = await this.repository.devicesForAccount(account.id);
      if (existingDevices.length) throw new Error("DEVICE_ENROLLMENT_REQUIRED");
      device = { id: randomUUID(), accountId: account.id, name: String(deviceName).slice(0, 100),
        createdAt: new Date(this.now()).toISOString(), revokedAt: null };
      await this.repository.saveDevice(device);
    }
    return { ...(await this.createSession(account.id, device.id)), accountId: account.id, deviceId: device.id,
      passwordKeyEnvelope: account.passwordKeyEnvelope, recoveryKeyEnvelope: account.recoveryKeyEnvelope };
  }
  async verifyEmail(token) {
    const account=await this.repository.accountByVerificationHash(tokenHash(token));
    if(!account||account.verificationExpiresAt<=this.now()) throw new Error("INVALID_VERIFICATION_TOKEN");
    await this.repository.markAccountVerified(account.id,new Date(this.now()).toISOString());return {verified:true};
  }
  async resendVerification(email) {
    const account=await this.repository.accountByEmail(normalizeEmail(email));
    if(!account||account.verifiedAt) return {accepted:true};
    const token=createOpaqueToken();await this.repository.updateVerification(account.id,tokenHash(token),this.now()+24*60*60*1000);
    await this.verificationSender.send({email:account.email,token});return {accepted:true};
  }
  async createSession(accountId, deviceId) {
    const accessToken = createOpaqueToken(); const refreshToken = createOpaqueToken(); const now = this.now();
    await this.repository.saveSession({ accountId, deviceId, accessHash: tokenHash(accessToken), refreshHash: tokenHash(refreshToken),
      accessExpiresAt: now + ACCESS_LIFETIME, refreshExpiresAt: now + REFRESH_LIFETIME, revokedAt: null });
    return { accessToken, refreshToken, accessExpiresAt: now + ACCESS_LIFETIME };
  }
  async refresh(refreshToken) {
    if (typeof refreshToken !== "string" || refreshToken.length < 32) throw new Error("INVALID_REFRESH_TOKEN");
    const refreshHash = tokenHash(refreshToken); const session = await this.repository.sessionByRefreshHash(refreshHash);
    if (!session) throw new Error("INVALID_REFRESH_TOKEN");
    const device = await this.repository.device(session.deviceId);
    if (!device || device.revokedAt) throw new Error("DEVICE_REVOKED");
    const accessToken=createOpaqueToken();const nextRefreshToken=createOpaqueToken();const now=this.now();const next={accountId:session.accountId,
      deviceId:session.deviceId,accessHash:tokenHash(accessToken),refreshHash:tokenHash(nextRefreshToken),accessExpiresAt:now+ACCESS_LIFETIME,
      refreshExpiresAt:now+REFRESH_LIFETIME,revokedAt:null};
    const rotation=await this.repository.rotateSession(refreshHash,next,now,new Date(now).toISOString());
    if(rotation.status==="replay")throw new Error("REFRESH_TOKEN_REUSE");
    if(rotation.status!=="rotated")throw new Error("INVALID_REFRESH_TOKEN");
    return {accessToken,refreshToken:nextRefreshToken,accessExpiresAt:next.accessExpiresAt};
  }
  async authenticate(accessToken) {
    if (typeof accessToken !== "string" || accessToken.length < 32) throw new Error("UNAUTHORIZED");
    const session = await this.repository.sessionByAccessHash(tokenHash(accessToken));
    if (!session || session.accessExpiresAt <= this.now()) throw new Error("UNAUTHORIZED");
    const device = await this.repository.device(session.deviceId);
    if (!device || device.revokedAt) throw new Error("DEVICE_REVOKED");
    return { accountId: session.accountId, deviceId: session.deviceId };
  }
  async revokeDevice(actorAccountId, deviceId) {
    const device = await this.repository.device(deviceId);
    if (!device || device.accountId !== actorAccountId) throw new Error("FORBIDDEN");
    await this.repository.revokeDevice(deviceId, new Date(this.now()).toISOString());
  }
  async logout({accountId,deviceId}) { const device=await this.repository.device(deviceId);
    if(!device||device.accountId!==accountId)throw new Error("FORBIDDEN");
    await this.repository.revokeSessionsForDevice(deviceId,new Date(this.now()).toISOString()); }
  async requestEnrollment({ email, password, deviceName }) {
    const account = await this.repository.accountByEmail(normalizeEmail(email));
    if (!account || !(await this.hasher.verify(account.passwordHash, password))) throw new Error("INVALID_CREDENTIALS");
    if (this.requireVerification && !account.verifiedAt) throw new Error("EMAIL_NOT_VERIFIED");
    const secret = createOpaqueToken();
    const enrollment = { id:randomUUID(),accountId:account.id,secretHash:tokenHash(secret),
      approvalCode:createApprovalCode(),deviceName:String(deviceName).slice(0,100),
      expiresAt:this.now()+10*60*1000,approvedAt:null,completedAt:null };
    await this.repository.saveEnrollment(enrollment);
    return { enrollmentId:enrollment.id,enrollmentSecret:secret,approvalCode:enrollment.approvalCode,expiresAt:enrollment.expiresAt };
  }
  async listEnrollments(accountId) {
    const items = await this.repository.pendingEnrollments(accountId); return items.filter((item) => item.expiresAt > this.now())
      .map((item) => ({ id:item.id,accountId:item.accountId,approvalCode:item.approvalCode,deviceName:item.deviceName,
        expiresAt:item.expiresAt,approvedAt:item.approvedAt,completedAt:item.completedAt }));
  }
  async approveEnrollment(accountId, enrollmentId, approvalCode) {
    const enrollment = await this.repository.enrollment(enrollmentId);
    if (!enrollment || enrollment.accountId !== accountId) throw new Error("FORBIDDEN");
    if (enrollment.expiresAt <= this.now() || enrollment.completedAt) throw new Error("ENROLLMENT_EXPIRED");
    if (enrollment.approvalCode !== approvalCode) throw new Error("INVALID_APPROVAL_CODE");
    enrollment.approvedAt = new Date(this.now()).toISOString(); await this.repository.updateEnrollment(enrollment);
  }
  async completeEnrollment(enrollmentId, secret) {
    const enrollment = await this.repository.enrollment(enrollmentId);
    if (!enrollment || enrollment.secretHash !== tokenHash(secret)) throw new Error("INVALID_ENROLLMENT");
    if (!enrollment.approvedAt || enrollment.completedAt || enrollment.expiresAt <= this.now()) throw new Error("ENROLLMENT_NOT_APPROVED");
    enrollment.completedAt = new Date(this.now()).toISOString(); await this.repository.updateEnrollment(enrollment);
    const account = await this.repository.accountById(enrollment.accountId);
    const device = { id:randomUUID(),accountId:account.id,name:enrollment.deviceName,createdAt:enrollment.completedAt,revokedAt:null };
    await this.repository.saveDevice(device);
    return { ...(await this.createSession(account.id,device.id)),accountId:account.id,deviceId:device.id,passwordKeyEnvelope:account.passwordKeyEnvelope,
      recoveryKeyEnvelope:account.recoveryKeyEnvelope };
  }
}
