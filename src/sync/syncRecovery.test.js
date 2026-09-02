import {describe,expect,it} from "vitest";
import {createRevisionRestoreOperation} from "./syncRecovery";

describe("revision recovery",()=>{
  it("restores old content against the newest known server snapshot",()=>{
    const old={id:"h1",entityType:"task",entityId:"task-1",serverRevision:2,payload:{text:"Old",
      _sync:{id:"task-1",serverRevision:2,localRevision:2}}};
    const latest={id:"h2",entityType:"task",entityId:"task-1",serverRevision:7,payload:{text:"Current",
      _sync:{id:"task-1",serverRevision:7,localRevision:5}}};
    const operation=createRevisionRestoreOperation(old,[old,latest],{deviceId:"device-a",now:()=>"2026-09-01T00:00:00.000Z",
      id:()=>"restore-op"});
    expect(operation).toMatchObject({operationId:"restore-op",entityId:"task-1",baseRevision:7,
      basePayload:{text:"Current"},payload:{text:"Old",_sync:{serverRevision:7,localRevision:6,deletedAt:null}}});
  });
});
