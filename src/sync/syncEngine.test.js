import { describe, expect, it, vi } from "vitest";
import { InMemorySyncServer } from "./inMemorySyncServer";
import { SyncEngine } from "./syncEngine";

function operation(overrides = {}) {
  return {
    operationId: "op-1", entityType: "task", entityId: "task-1", deviceId: "device-a", action: "upsert",
    baseRevision: 0, localRevision: 1, basePayload: { text: "Task", _sync: { id: "task-1", serverRevision: 0 } },
    payload: { text: "Task", _sync: { id: "task-1", serverRevision: 0 } },
    createdAt: "2026-08-31T00:00:00.000Z", attempts: 0, ...overrides,
  };
}

class MemoryStorage {
  constructor(outbox = []) { this.outbox = outbox; this.metadata = new Map(); this.applied = []; }
  async loadOutbox() { return structuredClone(this.outbox); }
  async acknowledge(ids) { this.outbox = this.outbox.filter((item) => !ids.includes(item.operationId)); }
  async markFailed(operations, error, now) {
    for (const item of operations) {
      const stored = this.outbox.find((candidate) => candidate.operationId === item.operationId);
      stored.attempts += 1; stored.lastError = error.message; stored.nextAttemptAt = new Date(now + 2000).toISOString();
    }
  }
  async getMetadata(key) { return this.metadata.get(key); }
  async setMetadata(key, value) { this.metadata.set(key, structuredClone(value)); }
  async applyChanges(changes) { this.applied.push(...structuredClone(changes)); }
  async resolveConflicts(resolutions) { for(const resolution of resolutions){await this.acknowledge([resolution.operationId]);
    this.outbox.push(...structuredClone(resolution.operations));} }
}

describe("sync engine protocol", () => {
  it("acknowledges a push, advances its cursor, and safely deduplicates a replay", async () => {
    const server = new InMemorySyncServer();
    const storage = new MemoryStorage([operation()]);
    const engine = new SyncEngine({ transport: server, storage, workspaceId: "personal", deviceId: "device-a" });
    const result = await engine.synchronize();

    expect(result.cursor).toBe(1);
    expect(storage.outbox).toEqual([]);
    expect(storage.applied).toHaveLength(1);

    storage.outbox.push(operation());
    await engine.synchronize();
    expect(server.workspace("personal").changes).toHaveLength(1);
    expect(storage.outbox).toEqual([]);
  });

  it("retains failed operations and schedules exponential retry", async () => {
    const storage = new MemoryStorage([operation()]);
    const transport = { pull: vi.fn().mockResolvedValue({ changes: [], nextCursor: 0, hasMore: false }),
      push: vi.fn().mockRejectedValue(new Error("offline")) };
    const engine = new SyncEngine({ transport, storage, workspaceId: "personal", deviceId: "device-a", now: () => 1000 });

    await expect(engine.synchronize()).rejects.toThrow("offline");
    expect(storage.outbox[0]).toMatchObject({ attempts: 1, lastError: "offline",
      nextAttemptAt: new Date(3000).toISOString() });
  });

  it("reports stale revisions instead of overwriting a newer device", async () => {
    const server = new InMemorySyncServer();
    const first = new SyncEngine({ transport: server, storage: new MemoryStorage([operation()]),
      workspaceId: "personal", deviceId: "device-a" });
    await first.synchronize();

    const staleStorage = new MemoryStorage([operation({ operationId: "op-2", deviceId: "device-b",
      payload: { text: "Stale", _sync: { id: "task-1", serverRevision: 0 } } })]);
    const stale = new SyncEngine({ transport: server, storage: staleStorage, workspaceId: "personal", deviceId: "device-b" });
    const result = await stale.synchronize();

    expect(result.conflicts).toHaveLength(1);
    expect(staleStorage.outbox).toHaveLength(1);
    expect(staleStorage.metadata.get("conflicts")[0].serverRevision).toBe(1);
  });

  it("isolates changes belonging to different workspaces", async () => {
    const server = new InMemorySyncServer();
    await server.push({ protocolVersion: 1, workspaceId: "one", deviceId: "a", operations: [operation()] });
    expect((await server.pull({ workspaceId: "two", cursor: 0 })).changes).toEqual([]);
  });

  it("rejects stale resurrection after the retained tombstone payload is archived",async()=>{
    const server=new InMemorySyncServer();const deleted=operation({action:"delete",payload:{text:"Old",
      _sync:{id:"task-1",serverRevision:0,deletedAt:"2026-01-01"}},basePayload:{text:"Old"}});
    await server.push({protocolVersion:1,workspaceId:"personal",deviceId:"device-a",operations:[deleted]});
    server.archiveTombstonePayloads("9999-01-01T00:00:00.000Z");
    const response=await server.push({protocolVersion:1,workspaceId:"personal",deviceId:"device-b",operations:[operation({
      operationId:"stale-upsert",payload:{text:"Resurrected",_sync:{id:"task-1",serverRevision:0}},baseRevision:0})]});
    expect(response.acknowledgedOperationIds).toEqual([]);expect(response.conflicts[0]).toMatchObject({serverRevision:1,
      serverAction:"delete",serverPayload:null});
  });

  it("merges concurrent edits to different fields without losing either edit",async()=>{
    const server=new InMemorySyncServer();const base={text:"Base",done:false,_sync:{id:"task-1",serverRevision:0,localRevision:1}};
    await server.push({protocolVersion:1,workspaceId:"personal",deviceId:"seed",operations:[operation({payload:base,basePayload:null})]});
    const localA={...structuredClone(base),text:"Edited on A",_sync:{...base._sync,serverRevision:1,localRevision:2}};
    const localB={...structuredClone(base),done:true,_sync:{...base._sync,serverRevision:1,localRevision:2}};
    await new SyncEngine({transport:server,storage:new MemoryStorage([operation({operationId:"op-a",baseRevision:1,
      basePayload:base,payload:localA})]),workspaceId:"personal",deviceId:"device-a"}).synchronize();
    const storageB=new MemoryStorage([operation({operationId:"op-b",deviceId:"device-b",baseRevision:1,basePayload:base,payload:localB})]);
    const engineB=new SyncEngine({transport:server,storage:storageB,workspaceId:"personal",deviceId:"device-b"});
    const first=await engineB.synchronize();expect(first.conflicts).toHaveLength(1);expect(storageB.outbox).toHaveLength(1);
    await engineB.synchronize();const latest=server.workspace("personal").entities.get("task:task-1").payload;
    expect(latest).toMatchObject({text:"Edited on A",done:true});
  });

  it("publishes a separate conflict copy when concurrent edits overlap",async()=>{
    const server=new InMemorySyncServer();const base={text:"Base",_sync:{id:"task-1",serverRevision:0,localRevision:1}};
    await server.push({protocolVersion:1,workspaceId:"personal",deviceId:"seed",operations:[operation({payload:base,basePayload:null})]});
    await new SyncEngine({transport:server,storage:new MemoryStorage([operation({operationId:"op-a",baseRevision:1,basePayload:base,
      payload:{text:"Device A",_sync:{id:"task-1",serverRevision:1,localRevision:2}}})]),workspaceId:"personal",deviceId:"a"}).synchronize();
    const storage=new MemoryStorage([operation({operationId:"op-b",baseRevision:1,basePayload:base,
      payload:{text:"Device B",_sync:{id:"task-1",serverRevision:1,localRevision:2}}})]);
    const engine=new SyncEngine({transport:server,storage,workspaceId:"personal",deviceId:"b"});await engine.synchronize();
    expect(storage.outbox).toHaveLength(2);expect(storage.outbox.some((item)=>item.payload.text==="Device B (conflict copy)")).toBe(true);
    await engine.synchronize();expect([...server.workspace("personal").entities.values()].map(({payload})=>payload.text).sort())
      .toEqual(["Device A","Device B (conflict copy)"]);
  });
});
