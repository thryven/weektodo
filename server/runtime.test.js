import { describe, expect, it, vi } from "vitest";
import { createServerRuntime, resolveRuntimeConfig } from "./runtime.mjs";
import { migrationPoolOptions, runtimePoolOptions } from "./databaseConfig.mjs";

const baseEnv = { DATABASE_URL: "postgresql://example.invalid/weektodo",
  AUDIT_HASH_KEY: "0123456789abcdef0123456789abcdef" };

describe("server runtime boundary", () => {
  it("validates production-only settings without opening a listener", () => {
    expect(() => resolveRuntimeConfig({ ...baseEnv, NODE_ENV: "production" }))
      .toThrow("VERIFICATION_WEBHOOK_URL is required in production");
    const config = resolveRuntimeConfig({ ...baseEnv, NODE_ENV: "production",
      PUBLIC_APP_URL: "https://planner.example.com", VERIFICATION_WEBHOOK_URL: "https://mailer.example.com/send",
      DATABASE_SSL: "true", DATABASE_SSL_REJECT_UNAUTHORIZED: "true" });
    expect(config).toMatchObject({ production: true, publicAppUrl: "https://planner.example.com",
      databaseSsl: true, databaseSslRejectUnauthorized: true });
  });

  it("constructs reusable dependencies and owns cleanup without calling listen", async () => {
    const app = { close: vi.fn().mockResolvedValue(), listen: vi.fn() };
    const pool = { query: vi.fn(), connect: vi.fn(), end: vi.fn().mockResolvedValue() };
    const buildServerFn = vi.fn().mockResolvedValue(app);
    const runtime = await createServerRuntime({ env: baseEnv, pool, buildServerFn, logger: false });
    expect(buildServerFn).toHaveBeenCalledOnce();
    expect(app.listen).not.toHaveBeenCalled();
    await runtime.close();
    await runtime.close();
    expect(app.close).toHaveBeenCalledOnce();
    expect(pool.end).toHaveBeenCalledOnce();
  });

  it("releases the database pool when server construction fails", async () => {
    const pool = { end: vi.fn().mockResolvedValue() };
    await expect(createServerRuntime({ env: baseEnv, pool,
      buildServerFn: vi.fn().mockRejectedValue(new Error("build failed")) })).rejects.toThrow("build failed");
    expect(pool.end).toHaveBeenCalledOnce();
  });

  it("limits every serverless runtime pool and expires idle connections", async () => {
    expect(runtimePoolOptions({ ...baseEnv, DATABASE_SSL: "true" })).toMatchObject({
      connectionString: baseEnv.DATABASE_URL, ssl: { rejectUnauthorized: true }, max: 2,
      idleTimeoutMillis: 10_000, connectionTimeoutMillis: 10_000,
    });
    const pools = [];
    class PoolStub {
      constructor(options) { this.options = options; this.end = vi.fn().mockResolvedValue(); pools.push(this); }
    }
    const runtimes = await Promise.all(Array.from({ length: 4 }, () => createServerRuntime({
      env: baseEnv, PoolClass: PoolStub, logger: false,
      buildServerFn: vi.fn().mockResolvedValue({ close: vi.fn().mockResolvedValue() }),
    })));
    expect(pools).toHaveLength(4);
    expect(pools.every(({ options }) => options.max === 2)).toBe(true);
    await Promise.all(runtimes.map((runtime) => runtime.close()));
  });

  it("keeps migration and runtime connection purposes separate", () => {
    const env = { ...baseEnv, MIGRATION_DATABASE_URL: "postgresql://direct.invalid/postgres",
      MIGRATION_DATABASE_SSL: "true", MIGRATION_DATABASE_SSL_REJECT_UNAUTHORIZED: "false" };
    expect(runtimePoolOptions(env).connectionString).toBe(baseEnv.DATABASE_URL);
    expect(migrationPoolOptions(env)).toMatchObject({ connectionString: env.MIGRATION_DATABASE_URL,
      ssl: { rejectUnauthorized: false } });
    expect(migrationPoolOptions(baseEnv).connectionString).toBe(baseEnv.DATABASE_URL);
  });
});
