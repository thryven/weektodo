import { describe,expect,it } from "vitest";
import { databaseReadiness,requiredMigrations } from "./operationalHealth.mjs";

describe("operational readiness",()=>{
  it("reports ready only when every numbered migration is applied",async()=>{
    const versions=await requiredMigrations();
    const readyPool={query:async(sql)=>sql==="SELECT 1"?{rows:[{ok:1}]}:{rows:versions.map((version)=>({version}))}};
    await expect(databaseReadiness(readyPool)).resolves.toEqual({ready:true});
    const pendingPool={query:async(sql)=>sql==="SELECT 1"?{rows:[{ok:1}]}:{rows:[]}};
    await expect(databaseReadiness(pendingPool)).resolves.toMatchObject({ready:false,reason:"migrations_pending",missing:versions});
  });
  it("does not expose database error details",async()=>{
    const pool={query:async()=>{throw new Error("secret connection string");}};
    await expect(databaseReadiness(pool)).resolves.toEqual({ready:false,reason:"database_unavailable"});
  });
});
