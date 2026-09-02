const boolean = (value, fallback = false) => value == null ? fallback : value === "true";

export function runtimePoolOptions(env = process.env) {
  if (!env.DATABASE_URL) throw new Error("DATABASE_URL is required");
  return {
    connectionString: env.DATABASE_URL,
    ssl: boolean(env.DATABASE_SSL) ? {
      rejectUnauthorized: boolean(env.DATABASE_SSL_REJECT_UNAUTHORIZED, true),
    } : false,
    max: 2,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 10_000,
  };
}

export function migrationPoolOptions(env = process.env) {
  const connectionString = env.MIGRATION_DATABASE_URL || env.DATABASE_URL;
  if (!connectionString) throw new Error("MIGRATION_DATABASE_URL or DATABASE_URL is required");
  const sslEnabled = boolean(env.MIGRATION_DATABASE_SSL, boolean(env.DATABASE_SSL));
  const rejectUnauthorized = boolean(env.MIGRATION_DATABASE_SSL_REJECT_UNAUTHORIZED,
    boolean(env.DATABASE_SSL_REJECT_UNAUTHORIZED, true));
  return {
    connectionString,
    ssl: sslEnabled ? { rejectUnauthorized } : false,
  };
}
