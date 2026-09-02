import { describe,expect,it,vi } from "vitest";
import { setTimeout as delay } from "node:timers/promises";
import { PostgresNotificationHub } from "./notificationHub.mjs";

function sharedDatabase(initialRevision=0) {
  const state={revision:initialRevision,queries:0};
  return {state,pool:{query:vi.fn(async()=>{state.queries+=1;return{rows:state.exists===false?[]:[{revision:state.revision}]};})}};
}

describe("database-backed sync notifications",()=>{
  it("observes a push made through another function instance and survives an instance restart",async()=>{
    const database=sharedDatabase(0);
    const waitingInstance=new PostgresNotificationHub(database.pool,{timeoutMs:200,pollIntervalMs:5});
    const pushingInstance=new PostgresNotificationHub(database.pool,{timeoutMs:200,pollIntervalMs:5});
    const waiting=waitingInstance.wait("workspace",0);
    await delay(10);database.state.revision=1;pushingInstance.publish("workspace");
    await expect(waiting).resolves.toBe(1);
    const restartedInstance=new PostgresNotificationHub(database.pool,{timeoutMs:50,pollIntervalMs:5});
    await expect(restartedInstance.wait("workspace",0)).resolves.toBe(1);
  });

  it("returns the current revision normally when the polling window expires",async()=>{
    const database=sharedDatabase(4);const hub=new PostgresNotificationHub(database.pool,{timeoutMs:15,pollIntervalMs:5});
    await expect(hub.wait("workspace",4)).resolves.toBe(4);expect(database.state.queries).toBeGreaterThan(1);
  });

  it("stops issuing database queries when the requester disconnects",async()=>{
    const database=sharedDatabase(0);const hub=new PostgresNotificationHub(database.pool,{timeoutMs:1000,pollIntervalMs:10});
    const controller=new globalThis.AbortController();const waiting=hub.wait("workspace",0,{signal:controller.signal});
    await delay(15);controller.abort();await expect(waiting).resolves.toBe(0);
    const queryCount=database.state.queries;await delay(25);
    expect(database.state.queries).toBe(queryCount);
  });

  it("treats a workspace without sync state as revision zero",async()=>{
    const database=sharedDatabase();database.state.exists=false;
    const hub=new PostgresNotificationHub(database.pool,{timeoutMs:0});
    await expect(hub.wait("workspace",0)).resolves.toBe(0);
  });
});
