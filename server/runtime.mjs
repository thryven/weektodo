import { Pool } from "pg";
import { buildServer } from "./app.mjs";
import { PostgresIdentityRepository } from "./postgresIdentityRepository.mjs";
import { PostgresSyncServer } from "./postgresSyncServer.mjs";
import { PostgresAuditRepository } from "./auditRepository.mjs";
import { ConsoleVerificationSender, WebhookVerificationSender } from "./verificationSender.mjs";
import { AuthService } from "./authService.mjs";
import { databaseReadiness } from "./operationalHealth.mjs";
import { PostgresNotificationHub } from "./notificationHub.mjs";
import { runtimePoolOptions } from "./databaseConfig.mjs";

export function resolveRuntimeConfig(env = process.env) {
  const production = env.NODE_ENV === "production";
  const publicAppUrl = env.PUBLIC_APP_URL || (production ? null : "http://localhost:5173");
  if (!env.DATABASE_URL) throw new Error("DATABASE_URL is required");
  if (production && !env.VERIFICATION_WEBHOOK_URL) {
    throw new Error("VERIFICATION_WEBHOOK_URL is required in production");
  }
  if (!publicAppUrl) throw new Error("PUBLIC_APP_URL is required in production");
  if (!env.AUDIT_HASH_KEY || env.AUDIT_HASH_KEY.length < 32) {
    throw new Error("AUDIT_HASH_KEY must be at least 32 characters");
  }
  return {
    production,
    publicAppUrl,
    databaseUrl: env.DATABASE_URL,
    databaseSsl: env.DATABASE_SSL === "true",
    databaseSslRejectUnauthorized: env.DATABASE_SSL_REJECT_UNAUTHORIZED !== "false",
    auditHashKey: env.AUDIT_HASH_KEY,
    verificationWebhookUrl: env.VERIFICATION_WEBHOOK_URL || null,
    verificationWebhookAuthorization: env.VERIFICATION_WEBHOOK_AUTHORIZATION || null,
  };
}

export async function createServerRuntime({ env = process.env, pool: suppliedPool = null,
  PoolClass = Pool, buildServerFn = buildServer, logger = true } = {}) {
  const config = resolveRuntimeConfig(env);
  const pool = suppliedPool || new PoolClass(runtimePoolOptions(env));
  const identityRepository = new PostgresIdentityRepository(pool);
  const verificationSender = config.verificationWebhookUrl
    ? new WebhookVerificationSender({ url: config.verificationWebhookUrl, publicAppUrl: config.publicAppUrl,
      authorization: config.verificationWebhookAuthorization })
    : new ConsoleVerificationSender({ publicAppUrl: config.publicAppUrl });
  let app;
  try {
    app = await buildServerFn({ logger, identityRepository,
      authService: new AuthService({ repository: identityRepository, verificationSender }),
      syncServer: new PostgresSyncServer(pool), auditRepository: new PostgresAuditRepository(pool),
      notificationHub: new PostgresNotificationHub(pool),
      auditHashKey: config.auditHashKey, secureCookies: config.production, trustProxy: config.production,
      readinessCheck: () => databaseReadiness(pool) });
  } catch (error) {
    await pool.end();
    throw error;
  }
  let closed = false;
  return { app, pool, config, async close() {
    if (closed) return;
    closed = true;
    await app.close();
    await pool.end();
  } };
}
