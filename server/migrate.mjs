import { readFile, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { migrationPoolOptions } from "./databaseConfig.mjs";

export async function migrate(pool, baseDirectory = dirname(fileURLToPath(import.meta.url))) {
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock(9152026)");
    await client.query("BEGIN");
    await client.query(await readFile(join(baseDirectory, "schema.sql"), "utf8"));
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);
    const { rows } = await client.query("SELECT version FROM schema_migrations");
    const applied = new Set(rows.map(({ version }) => version));
    const files = (await readdir(join(baseDirectory, "migrations"))).filter((name) => /^\d+.*\.sql$/.test(name)).sort();
    for (const file of files) {
      if (applied.has(file)) continue;
      await client.query(await readFile(join(baseDirectory, "migrations", file), "utf8"));
      await client.query("INSERT INTO schema_migrations(version) VALUES($1)", [file]);
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK"); throw error;
  } finally {
    await client.query("SELECT pg_advisory_unlock(9152026)"); client.release();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const pool = new Pool(migrationPoolOptions());
  try { await migrate(pool); } finally { await pool.end(); }
}
