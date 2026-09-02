import {describe,expect,it} from "vitest";
import {mergeFields,resolveConflict} from "./conflictResolver";

describe("field-level conflict recovery",()=>{
  it("combines independent fields and recursively merges nested objects",()=>{
    const result=mergeFields({text:"Old",done:false,reminder:{at:1,sound:"bell"}},
      {text:"Local",done:false,reminder:{at:1,sound:"soft"}},{text:"Old",done:true,reminder:{at:2,sound:"bell"}});
    expect(result).toEqual({merged:{text:"Local",done:true,reminder:{at:2,sound:"soft"}},conflicts:[]});
  });
  it("keeps the remote canonical value and creates a labeled local copy for overlapping edits",()=>{
    let sequence=0;const operation={operationId:"old-op",entityType:"task",entityId:"task-1",action:"upsert",baseRevision:1,
      basePayload:{text:"Base",done:false,_sync:{id:"task-1",serverRevision:1,localRevision:1}},
      payload:{text:"Local",done:false,_sync:{id:"task-1",serverRevision:1,localRevision:2}}};
    const result=resolveConflict(operation,{serverRevision:2,serverPayload:{text:"Remote",done:true,
      _sync:{id:"task-1",serverRevision:2,localRevision:2}}},{deviceId:"device-a",now:()=>"2026-01-01T00:00:00.000Z",id:()=>`id-${++sequence}`});
    expect(result.conflictFields).toEqual(["text"]);expect(result.operations[0].payload).toMatchObject({text:"Remote",done:true});
    expect(result.operations[1].payload.text).toBe("Local (conflict copy)");
    expect(result.operations[1].payload._sync.conflictOf).toBe("task-1");expect(result.history).toHaveLength(3);
  });
  it("preserves a local edit as a conflict copy when the remote revision deleted the entity",()=>{
    let sequence=0;const operation={operationId:"op",entityType:"task",entityId:"task-1",action:"upsert",baseRevision:1,
      basePayload:{text:"Base",_sync:{id:"task-1"}},payload:{text:"Edited offline",_sync:{id:"task-1",localRevision:2}}};
    const result=resolveConflict(operation,{serverRevision:2,serverAction:"delete",serverPayload:{text:"Base",
      _sync:{id:"task-1",deletedAt:"2026-01-01"}}},{deviceId:"device-a",id:()=>`id-${++sequence}`});
    expect(result.conflictFields).toEqual(["$deleted"]);expect(result.operations).toHaveLength(1);
    expect(result.operations[0].entityId).not.toBe("task-1");
  });
});
