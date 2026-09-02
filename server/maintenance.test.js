import { describe,expect,it } from "vitest";
import { runMaintenance } from "./maintenance.mjs";

describe("database maintenance",()=>{
  it("cleans bounded retention tables in one transaction",async()=>{
    const calls=[];const client={query:async(sql,params)=>{calls.push({sql,params});
      if(sql.startsWith("DELETE FROM security"))return {rowCount:2};if(sql.startsWith("DELETE FROM sessions"))return {rowCount:3};
      if(sql.startsWith("DELETE FROM device"))return {rowCount:4};if(sql.startsWith("DELETE FROM sync_entities"))return {rowCount:5};
      return {rowCount:0};},release:()=>calls.push({sql:"RELEASE"})};
    const result=await runMaintenance({connect:async()=>client},{auditRetentionDays:60,sessionRetentionDays:14});
    expect(result).toEqual({auditEventsDeleted:2,sessionsDeleted:3,enrollmentsDeleted:4,tombstonePayloadsArchived:5});
    expect(calls.map(({sql})=>sql)).toContain("COMMIT");expect(calls.find(({sql})=>sql.startsWith("DELETE FROM security")).params).toEqual([60]);
  });
});
