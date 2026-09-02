import { generateAccountKey, generateRecoveryKey, unwrapAccountKeyWithPassword,
  wrapAccountKeyWithPassword, wrapAccountKeyWithRecoveryKey } from "./crypto";

export class SyncAccountClient {
  constructor({ baseUrl, fetchImplementation } = {}) {
    this.baseUrl=String(baseUrl || "").replace(/\/$/, "");this.fetch=fetchImplementation||globalThis.fetch.bind(globalThis);this.session=null;
  }
  setBaseUrl(baseUrl) { this.baseUrl=String(baseUrl||"").replace(/\/$/,""); }
  async request(path, options={}) {
    const response=await this.fetch(`${this.baseUrl}/v1${path}`,{credentials:"include",...options,
      headers:{...(options.body!==undefined ? {"Content-Type":"application/json"} : {}),
        ...(this.session?.accessToken ? {Authorization:`Bearer ${this.session.accessToken}`} : {}),
        ...options.headers}});
    const body=response.status===204 ? null : await response.json();
    if(!response.ok) throw new Error(body?.error || `Request failed with status ${response.status}`);return body;
  }
  async prepareRegistration() {
    const accountKey=await generateAccountKey();const recoveryKey=generateRecoveryKey();
    return {accountKey,recoveryKey};
  }
  async register({email,password,accountKey,recoveryKey,recoveryConfirmed}) {
    if(!recoveryConfirmed) throw new Error("RECOVERY_KEY_CONFIRMATION_REQUIRED");
    const [passwordKeyEnvelope,recoveryKeyEnvelope]=await Promise.all([
      wrapAccountKeyWithPassword(accountKey,password),wrapAccountKeyWithRecoveryKey(accountKey,recoveryKey)]);
    return this.request("/auth/register",{method:"POST",body:JSON.stringify({email,password,passwordKeyEnvelope,recoveryKeyEnvelope})});
  }
  async verify(token) { return this.request("/auth/verify",{method:"POST",body:JSON.stringify({token})}); }
  async resendVerification(email) { return this.request("/auth/verification/resend",{method:"POST",body:JSON.stringify({email})}); }
  async login({email,password,deviceName,deviceId}) {
    const result=await this.request("/auth/login",{method:"POST",body:JSON.stringify({email,password,deviceName,deviceId})});
    const accountKey=await unwrapAccountKeyWithPassword(result.passwordKeyEnvelope,password);
    this.session={...result,accountKey};return this.session;
  }
  async accessToken() {
    if(!this.session) return null;
    if(this.session.accessExpiresAt-Date.now()>30000) return this.session.accessToken;
    const refreshed=await this.request("/auth/refresh",{method:"POST"});this.session={...this.session,...refreshed};
    return this.session.accessToken;
  }
  accountKey() { return this.session?.accountKey || null; }
  async devices() { return this.request("/devices"); }
  async revokeDevice(id) { return this.request(`/devices/${encodeURIComponent(id)}`,{method:"DELETE"}); }
  async logout() { await this.request("/auth/logout",{method:"POST"});this.session=null; }
  async requestEnrollment({email,password,deviceName}) { return this.request("/enrollments",{method:"POST",
    body:JSON.stringify({email,password,deviceName})}); }
  async completeEnrollment({enrollmentId,enrollmentSecret,password}) {
    const result=await this.request(`/enrollments/${encodeURIComponent(enrollmentId)}/complete`,{method:"POST",
      body:JSON.stringify({enrollmentSecret})});
    this.session={...result,accountKey:await unwrapAccountKeyWithPassword(result.passwordKeyEnvelope,password)};return this.session;
  }
  async enrollments() { return this.request("/enrollments"); }
  async approveEnrollment(id,approvalCode) { return this.request(`/enrollments/${encodeURIComponent(id)}/approve`,{method:"POST",
    body:JSON.stringify({approvalCode})}); }
}
