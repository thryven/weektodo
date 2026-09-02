import { readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export async function requiredMigrations(baseDirectory=dirname(fileURLToPath(import.meta.url))) {
  return (await readdir(join(baseDirectory,"migrations"))).filter((name)=>/^\d+.*\.sql$/.test(name)).sort();
}

export async function databaseReadiness(pool,baseDirectory) {
  try {
    await pool.query("SELECT 1");
    const required=await requiredMigrations(baseDirectory);
    const {rows}=await pool.query("SELECT version FROM schema_migrations");const applied=new Set(rows.map(({version})=>version));
    const missing=required.filter((version)=>!applied.has(version));
    return missing.length ? {ready:false,reason:"migrations_pending",missing} : {ready:true};
  } catch {
    return {ready:false,reason:"database_unavailable"};
  }
}
