import { describe, expect, it } from "vitest";
import { AuthService } from "./authService.mjs";
import { InMemoryIdentityRepository } from "./inMemoryIdentityRepository.mjs";

const hasher = { hash: async (value) => `hash:${value}`, verify: async (hash, value) => hash === `hash:${value}` };

describe("account and device sessions", () => {
  it("normalizes accounts, authenticates devices, rotates refresh tokens, and rejects replay", async () => {
    const repository = new InMemoryIdentityRepository(); const auth = new AuthService({ repository, hasher, now: () => 1000,
      requireVerification: false });
    await auth.register({ email: " User@Example.COM ", password: "long-enough-password", passwordKeyEnvelope: {}, recoveryKeyEnvelope: {} });
    const login = await auth.login({ email: "user@example.com", password: "long-enough-password", deviceName: "Laptop" });
    expect(await auth.authenticate(login.accessToken)).toMatchObject({ deviceId: login.deviceId });
    const rotated = await auth.refresh(login.refreshToken);
    await expect(auth.refresh(login.refreshToken)).rejects.toThrow("REFRESH_TOKEN_REUSE");
    await expect(auth.authenticate(rotated.accessToken)).rejects.toThrow("UNAUTHORIZED");
    expect(rotated.refreshToken).not.toBe(login.refreshToken);
  });

  it("revokes every session for a device and enforces account ownership", async () => {
    const repository = new InMemoryIdentityRepository(); const auth = new AuthService({ repository, hasher, now: () => 1000,
      requireVerification: false });
    const account = await auth.register({ email: "a@example.com", password: "long-enough-password", passwordKeyEnvelope: {}, recoveryKeyEnvelope: {} });
    const login = await auth.login({ email: "a@example.com", password: "long-enough-password", deviceName: "PC" });
    await expect(auth.revokeDevice("another-account", login.deviceId)).rejects.toThrow("FORBIDDEN");
    await auth.revokeDevice(account.id, login.deviceId);
    await expect(auth.authenticate(login.accessToken)).rejects.toThrow();
  });

  it("logs out all sessions for the current device without revoking the device",async()=>{
    const repository=new InMemoryIdentityRepository();const auth=new AuthService({repository,hasher,now:()=>1000,requireVerification:false});
    const account=await auth.register({email:"logout@example.com",password:"long-enough-password",passwordKeyEnvelope:{},recoveryKeyEnvelope:{}});
    const login=await auth.login({email:account.email,password:"long-enough-password",deviceName:"PC"});
    await auth.logout({accountId:account.id,deviceId:login.deviceId});
    await expect(auth.authenticate(login.accessToken)).rejects.toThrow("UNAUTHORIZED");
    expect((await repository.device(login.deviceId)).revokedAt).toBeNull();
  });

  it("requires approval by an existing device and completes enrollment only once", async () => {
    const repository = new InMemoryIdentityRepository(); const auth = new AuthService({ repository, hasher, now: () => 1000,
      requireVerification: false });
    const account = await auth.register({ email:"owner@example.com",password:"long-enough-password",
      passwordKeyEnvelope:{wrapped:true},recoveryKeyEnvelope:{} });
    await auth.login({email:"owner@example.com",password:"long-enough-password",deviceName:"First PC"});
    const request = await auth.requestEnrollment({ email:"owner@example.com",password:"long-enough-password",deviceName:"Second PC" });
    await expect(auth.login({email:"owner@example.com",password:"long-enough-password",deviceName:"Unapproved"}))
      .rejects.toThrow("DEVICE_ENROLLMENT_REQUIRED");
    await expect(auth.completeEnrollment(request.enrollmentId,request.enrollmentSecret)).rejects.toThrow("ENROLLMENT_NOT_APPROVED");
    await expect(auth.approveEnrollment("other-account",request.enrollmentId,request.approvalCode)).rejects.toThrow("FORBIDDEN");
    await auth.approveEnrollment(account.id,request.enrollmentId,request.approvalCode);
    const completed = await auth.completeEnrollment(request.enrollmentId,request.enrollmentSecret);
    expect(completed).toMatchObject({ passwordKeyEnvelope:{wrapped:true} });
    await expect(auth.completeEnrollment(request.enrollmentId,request.enrollmentSecret)).rejects.toThrow("ENROLLMENT_NOT_APPROVED");
  });

  it("requires a delivered, unexpired, single-use email verification token", async () => {
    const repository = new InMemoryIdentityRepository(); let delivered;
    const auth = new AuthService({ repository, hasher, now: () => 1000,
      verificationSender: { send: async (message) => { delivered = message; } } });
    await auth.register({ email: "verify@example.com", password: "long-enough-password",
      passwordKeyEnvelope: {}, recoveryKeyEnvelope: {} });
    expect(delivered.email).toBe("verify@example.com");
    await expect(auth.login({ email: delivered.email, password: "long-enough-password", deviceName: "PC" }))
      .rejects.toThrow("EMAIL_NOT_VERIFIED");
    await expect(auth.verifyEmail("wrong-token-that-is-long-enough-for-domain-test")).rejects.toThrow("INVALID_VERIFICATION_TOKEN");
    await expect(auth.verifyEmail(delivered.token)).resolves.toEqual({ verified: true });
    await expect(auth.verifyEmail(delivered.token)).rejects.toThrow("INVALID_VERIFICATION_TOKEN");
    await expect(auth.login({ email: delivered.email, password: "long-enough-password", deviceName: "PC" })).resolves.toBeTruthy();
  });
});
