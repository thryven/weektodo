import { describe, expect, it, vi } from "vitest";
import { buildServer } from "./app.mjs";
import { AuthService } from "./authService.mjs";
import { InMemoryIdentityRepository } from "./inMemoryIdentityRepository.mjs";
import { InMemoryAuditRepository } from "./auditRepository.mjs";

const hasher = { hash: async (value) => `hash:${value}`, verify: async (hash, value) => hash === `hash:${value}` };

async function account(app, email, name) {
  const registered = await app.inject({ method: "POST", url: "/v1/auth/register",
    payload: { email, password: "long-enough-password", passwordKeyEnvelope: {}, recoveryKeyEnvelope: {} } });
  const login = await app.inject({ method: "POST", url: "/v1/auth/login",
    payload: { email, password: "long-enough-password", deviceName: name } });
  return { account: registered.json(), session: login.json() };
}

describe("authenticated sync API", () => {
  it("rejects cross-account workspaces and mismatched device identities", async () => {
    const repository = new InMemoryIdentityRepository();
    const app = await buildServer({ identityRepository: repository,
      authService: new AuthService({ repository, hasher, requireVerification: false }) });
    const one = await account(app, "one@example.com", "One"); const two = await account(app, "two@example.com", "Two");
    const headers = { authorization: `Bearer ${one.session.accessToken}` };
    expect((await app.inject({ method: "GET", url: `/v1/sync/changes?workspaceId=${two.account.id}&cursor=0`, headers })).statusCode).toBe(403);
    const response = await app.inject({ method: "POST", url: "/v1/sync/changes", headers,
      payload: { protocolVersion: 1, workspaceId: one.account.id, deviceId: two.session.deviceId, operations: [] } });
    expect(response.statusCode).toBe(403); await app.close();
  });

  it("blocks a revoked device from every protected endpoint", async () => {
    const repository = new InMemoryIdentityRepository();
    const app = await buildServer({ identityRepository: repository,
      authService: new AuthService({ repository, hasher, requireVerification: false }) });
    const user = await account(app, "user@example.com", "PC"); const headers = { authorization: `Bearer ${user.session.accessToken}` };
    expect((await app.inject({ method: "GET", url: "/v1/devices", headers })).statusCode).toBe(200);
    expect((await app.inject({ method: "DELETE", url: `/v1/devices/${user.session.deviceId}`, headers })).statusCode).toBe(204);
    expect((await app.inject({ method: "GET", url: "/v1/devices", headers })).statusCode).toBe(401); await app.close();
  });

  it("keeps rotating refresh tokens in a hardened cookie and records privacy-safe audit events", async () => {
    const repository = new InMemoryIdentityRepository(); const auditRepository = new InMemoryAuditRepository();
    const app = await buildServer({ identityRepository: repository, auditRepository,
      authService: new AuthService({ repository, hasher, requireVerification: false }), secureCookies: true,
      auditHashKey: "test-secret-with-at-least-thirty-two-characters" });
    await app.inject({ method: "POST", url: "/v1/auth/register", payload: { email: "private@example.com",
      password: "long-enough-password", passwordKeyEnvelope: {}, recoveryKeyEnvelope: {} } });
    const login = await app.inject({ method: "POST", url: "/v1/auth/login", payload: { email: "private@example.com",
      password: "long-enough-password", deviceName: "PC" } });
    expect(login.json().refreshToken).toBeUndefined();
    const cookie = login.headers["set-cookie"];
    expect(cookie).toContain("wtd_refresh="); expect(cookie).toContain("HttpOnly"); expect(cookie).toContain("Secure");
    expect(cookie).toContain("SameSite=Strict");
    const refresh = await app.inject({ method: "POST", url: "/v1/auth/refresh", headers: { cookie: cookie.split(";")[0] } });
    expect(refresh.statusCode).toBe(200); expect(refresh.json().refreshToken).toBeUndefined();
    expect(refresh.headers["set-cookie"]).not.toBe(cookie);
    expect(JSON.stringify(auditRepository.events)).not.toContain("private@example.com");
    expect(JSON.stringify(auditRepository.events)).not.toContain("long-enough-password");
    expect(auditRepository.events.map(({ eventType }) => eventType)).toEqual(["account.register", "session.login","session.refresh"]);
    await app.close();
  });

  it("rate limits repeated login attempts",async()=>{
    const repository=new InMemoryIdentityRepository();const app=await buildServer({identityRepository:repository,
      authService:new AuthService({repository,hasher,requireVerification:false})});
    let response;for(let attempt=0;attempt<11;attempt++)response=await app.inject({method:"POST",url:"/v1/auth/login",
      payload:{email:"missing@example.com",password:"long-enough-password",deviceName:"PC"}});
    expect(response.statusCode).toBe(429);await app.close();
  });

  it("clears the refresh cookie and invalidates access on explicit logout",async()=>{
    const repository=new InMemoryIdentityRepository();const app=await buildServer({identityRepository:repository,
      authService:new AuthService({repository,hasher,requireVerification:false})});
    const user=await account(app,"logout-api@example.com","PC");const headers={authorization:`Bearer ${user.session.accessToken}`};
    const response=await app.inject({method:"POST",url:"/v1/auth/logout",headers});expect(response.statusCode).toBe(204);
    expect(response.headers["set-cookie"]).toContain("wtd_refresh=;");
    expect((await app.inject({method:"GET",url:"/v1/devices",headers})).statusCode).toBe(401);await app.close();
  });

  it("keeps liveness separate from migration-aware readiness",async()=>{
    const app=await buildServer({readinessCheck:async()=>({ready:false,reason:"migrations_pending",missing:["001.sql"]})});
    expect((await app.inject({method:"GET",url:"/health/live"})).statusCode).toBe(200);
    const ready=await app.inject({method:"GET",url:"/health/ready"});expect(ready.statusCode).toBe(503);
    expect(ready.json()).toEqual({status:"not_ready",reason:"migrations_pending"});await app.close();
  });
  it("passes request cancellation to notification polling",async()=>{
    const repository=new InMemoryIdentityRepository();let receivedSignal;
    const notificationHub={publish:()=>{},wait:vi.fn(async(_workspaceId,_after,{signal})=>{receivedSignal=signal;return 7;})};
    const app=await buildServer({identityRepository:repository,notificationHub,
      authService:new AuthService({repository,hasher,requireVerification:false})});
    const user=await account(app,"notifications@example.com","PC");
    const response=await app.inject({method:"GET",url:`/v1/sync/notifications?workspaceId=${user.account.id}&after=6`,
      headers:{authorization:`Bearer ${user.session.accessToken}`}});
    expect(response.statusCode).toBe(200);expect(response.json()).toEqual({version:7});
    expect(receivedSignal).toBeInstanceOf(globalThis.AbortSignal);await app.close();
  });
});
