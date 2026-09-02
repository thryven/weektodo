import Fastify from "fastify";
import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import { AuthService } from "./authService.mjs";
import { InMemoryIdentityRepository } from "./inMemoryIdentityRepository.mjs";
import { InMemorySyncServer } from "../src/sync/inMemorySyncServer.js";
import { NotificationHub } from "./notificationHub.mjs";
import { InMemoryAuditRepository, hashNetworkAddress } from "./auditRepository.mjs";

const REFRESH_COOKIE = "wtd_refresh";
const THIRTY_DAYS_SECONDS = 30 * 24 * 60 * 60;

function bearer(request) {
  const value = request.headers.authorization;
  if (!value?.startsWith("Bearer ")) throw new Error("UNAUTHORIZED");
  return value.slice(7);
}

export async function buildServer({ identityRepository = new InMemoryIdentityRepository(), authService, syncServer = new InMemorySyncServer(),
  notificationHub = new NotificationHub(), auditRepository = new InMemoryAuditRepository(), auditHashKey = "development-only",
  secureCookies = process.env.NODE_ENV === "production", readinessCheck = async () => ({ ready: true }), trustProxy = false,
  logger = false } = {}) {
  const app = Fastify({ logger, trustProxy, bodyLimit: 1024 * 1024 });
  const auth = authService || new AuthService({ repository: identityRepository });
  await app.register(cookie);
  await app.register(rateLimit, { global: true, max: 300, timeWindow: "1 minute" });

  const cookieOptions = { httpOnly: true, secure: secureCookies, sameSite: "strict", path: "/v1/auth",
    maxAge: THIRTY_DAYS_SECONDS };
  const audit = (request, eventType, outcome, details = {}) => auditRepository.record({ eventType, outcome,
    accountId: details.accountId || null, deviceId: details.deviceId || null,
    ipHash: hashNetworkAddress(request.ip, auditHashKey), createdAt: new Date().toISOString() }).catch(() => {});

  app.setErrorHandler((error, _request, reply) => {
    const status = error.statusCode === 429 ? 429
      : ["UNAUTHORIZED", "INVALID_CREDENTIALS", "INVALID_REFRESH_TOKEN", "REFRESH_TOKEN_REUSE"].includes(error.message) ? 401
      : ["FORBIDDEN", "DEVICE_REVOKED", "EMAIL_NOT_VERIFIED"].includes(error.message) ? 403
      : error.message === "ACCOUNT_EXISTS" ? 409 : 400;
    reply.code(status).send({ error: error.message });
  });

  app.post("/v1/auth/register", { config: { rateLimit: { max: 5, timeWindow: "1 minute" } }, schema: { body: { type: "object", required: ["email", "password", "passwordKeyEnvelope",
    "recoveryKeyEnvelope"], additionalProperties: false, properties: { email: { type: "string", format: "email", maxLength: 320 },
    password: { type: "string", minLength: 12, maxLength: 1024 }, passwordKeyEnvelope: { type: "object" },
    recoveryKeyEnvelope: { type: "object" } } } } }, async (request, reply) => {
    try { const result = await auth.register(request.body); await audit(request, "account.register", "success", { accountId: result.id });
      return reply.code(201).send(result); } catch (error) { await audit(request, "account.register", "failure"); throw error; }
  });

  app.post("/v1/auth/verify", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } }, schema: { body: { type: "object",
    required: ["token"], additionalProperties: false, properties: { token: { type: "string", minLength: 32, maxLength: 256 } } } } },
  async (request) => { try { const result = await auth.verifyEmail(request.body.token); await audit(request, "account.verify", "success");
    return result; } catch (error) { await audit(request, "account.verify", "failure"); throw error; } });
  app.post("/v1/auth/verification/resend", { config: { rateLimit: { max: 3, timeWindow: "15 minutes" } }, schema: { body: {
    type: "object", required: ["email"], additionalProperties: false, properties: { email: { type: "string", format: "email" } } } } },
  async (request) => { const result=await auth.resendVerification(request.body.email);
    await audit(request,"account.verification_resend","accepted");return result; });

  app.post("/v1/auth/login", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } }, schema: { body: { type: "object", required: ["email", "password", "deviceName"],
    additionalProperties: false, properties: { email: { type: "string", format: "email" }, password: { type: "string" },
    deviceName: { type: "string", minLength: 1, maxLength: 100 }, deviceId:{type:"string",format:"uuid"} } } } },
    async (request, reply) => { try { const session = await auth.login(request.body); const { refreshToken, ...result } = session;
      reply.setCookie(REFRESH_COOKIE, refreshToken, cookieOptions); await audit(request, "session.login", "success",
        { deviceId: result.deviceId }); return result; } catch (error) { await audit(request, "session.login", "failure"); throw error; } });
  app.post("/v1/auth/refresh", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (request, reply) => {
    try { const session = await auth.refresh(request.cookies[REFRESH_COOKIE]); const { refreshToken, ...result } = session;
      reply.setCookie(REFRESH_COOKIE, refreshToken, cookieOptions);await audit(request,"session.refresh","success");return result;
    } catch(error) { await audit(request,"session.refresh",error.message==="REFRESH_TOKEN_REUSE"?"suspected_replay":"failure");throw error; }
  });

  async function principal(request) { return auth.authenticate(bearer(request)); }
  app.post("/v1/auth/logout",async(request,reply)=>{const actor=await principal(request);await auth.logout(actor);
    reply.clearCookie(REFRESH_COOKIE,{path:"/v1/auth"});await audit(request,"session.logout","success",actor);reply.code(204).send();});
  function authorizeWorkspace(principalValue, workspaceId) {
    if (principalValue.accountId !== workspaceId) throw new Error("FORBIDDEN");
  }
  app.post("/v1/enrollments", { config: { rateLimit: { max: 5, timeWindow: "1 minute" } }, schema: { body: { type:"object",required:["email","password","deviceName"],
    additionalProperties:false,properties:{email:{type:"string",format:"email"},password:{type:"string"},
      deviceName:{type:"string",minLength:1,maxLength:100}} } } }, (request) => auth.requestEnrollment(request.body));
  app.get("/v1/enrollments", async (request) => { const actor = await principal(request); return auth.listEnrollments(actor.accountId); });
  app.post("/v1/enrollments/:enrollmentId/approve", { schema:{body:{type:"object",required:["approvalCode"],
    additionalProperties:false,properties:{approvalCode:{type:"string",pattern:"^[0-9]{6}$"}}}} }, async (request,reply) => {
    const actor=await principal(request); await auth.approveEnrollment(actor.accountId,request.params.enrollmentId,request.body.approvalCode);
    reply.code(204).send();
  });
  app.post("/v1/enrollments/:enrollmentId/complete", { schema:{body:{type:"object",required:["enrollmentSecret"],
    additionalProperties:false,properties:{enrollmentSecret:{type:"string",minLength:32}}}} }, async (request,reply) => {
    const session=await auth.completeEnrollment(request.params.enrollmentId,request.body.enrollmentSecret);
    const {refreshToken,...result}=session;reply.setCookie(REFRESH_COOKIE,refreshToken,cookieOptions);return result;
  });
  const pushSchema = { body: { type: "object", additionalProperties: false,
    required: ["protocolVersion","workspaceId","deviceId","operations"], properties: {
      protocolVersion: { const: 1 }, workspaceId: { type: "string", format: "uuid" },
      deviceId: { type: "string", format: "uuid" }, operations: { type: "array", maxItems: 500, items: {
        type: "object", required: ["operationId","entityType","entityId","action","baseRevision","localRevision","payload"],
        properties: { operationId:{type:"string",format:"uuid"}, entityType:{enum:["task","repeating_event","custom_list","settings"]},
          entityId:{type:"string",format:"uuid"}, action:{enum:["upsert","delete"]}, baseRevision:{type:"integer",minimum:0},
          localRevision:{type:"integer",minimum:0}, payload:{type:"object",additionalProperties:false,
            required:["version","algorithm","iv","ciphertext"],properties:{version:{const:1},algorithm:{const:"A256GCM"},
              iv:{type:"string",minLength:16,maxLength:24},ciphertext:{type:"string",minLength:16,maxLength:1048576}}} }
      } } } } };

  app.get("/health/live", async () => ({ status: "ok" }));
  app.get("/health/ready",async(_request,reply)=>{const status=await readinessCheck();
    if(!status.ready)return reply.code(503).send({status:"not_ready",reason:status.reason});return {status:"ready"};});

  app.get("/v1/devices", async (request) => {
    const actor = await principal(request); return identityRepository.devicesForAccount(actor.accountId);
  });
  app.delete("/v1/devices/:deviceId", async (request, reply) => {
    const actor = await principal(request); await auth.revokeDevice(actor.accountId, request.params.deviceId);
    await audit(request, "device.revoke", "success", { accountId: actor.accountId, deviceId: request.params.deviceId });
    if(actor.deviceId===request.params.deviceId)reply.clearCookie(REFRESH_COOKIE,{path:"/v1/auth"});reply.code(204).send();
  });
  app.post("/v1/sync/changes", { schema: pushSchema }, async (request) => {
    const actor = await principal(request); authorizeWorkspace(actor, request.body.workspaceId);
    if (actor.deviceId !== request.body.deviceId) throw new Error("FORBIDDEN");
    const response=await syncServer.push(request.body); if(response.acknowledgedOperationIds.length) notificationHub.publish(request.body.workspaceId);
    return response;
  });
  app.get("/v1/sync/changes", async (request) => {
    const actor = await principal(request); authorizeWorkspace(actor, request.query.workspaceId);
    return syncServer.pull({ workspaceId: request.query.workspaceId, cursor: Number(request.query.cursor || 0),
      limit: Math.min(Number(request.query.limit || 500), 500),deviceId:actor.deviceId });
  });
  app.get("/v1/sync/notifications", async (request,reply) => {
    const actor=await principal(request);authorizeWorkspace(actor,request.query.workspaceId);
    const controller=new AbortController();const abort=()=>controller.abort();
    request.raw.once("aborted",abort);reply.raw.once("close",abort);
    try { const version=await notificationHub.wait(request.query.workspaceId,Number(request.query.after||0),
      {signal:controller.signal});return {version}; }
    finally { request.raw.removeListener("aborted",abort);reply.raw.removeListener("close",abort); }
  });

  return app;
}
