import { describe, it, expect } from "vitest";
import { GoogleSyncEngine } from "./engine";
import { localFields, remoteFields, wireTask } from "./model";

const task = () => ({ text: "One", desc: "Notes", checked: false, listId: "20260919", _sync: { id: "local-1" } });
function fixture({ local = task(), remote, mapping, queue = {} } = {}) {
  let snapshot = { tasks: local ? [local] : [], mappings: mapping ? { "local-1": mapping } : {}, queue };
  const writes = [], commits = [];
  const repository = {
    snapshot: async () => structuredClone(snapshot),
    commit: async (entry) => { commits.push(entry); return {}; },
  };
  const transport = {
    tasks: async () => remote ? [remote] : [],
    write: async (entry) => { writes.push(entry); return { id: entry.taskId || "google-1", ...entry.task }; },
  };
  return { engine: new GoogleSyncEngine({ repository, transport, today: () => "20260919" }), repository, transport, writes, commits,
    setSnapshot: (value) => { snapshot = value; } };
}
describe("Google Tasks synchronization", () => {
  it("creates local tasks and saves a recoverable identity and mapping", async () => {
    const f = fixture(); await f.engine.synchronize("list");
    expect(f.writes[0].action).toBe("create"); expect(f.writes[0].task.notes).toContain("[WeekToDo:local-1]");
    expect(f.commits[0].mapping.googleId).toBe("google-1");
  });
  it("recovers an ambiguous create without inserting twice", async () => {
    const f = fixture({ remote: { id: "google-1", ...wireTask(localFields(task()), "local-1") } });
    await f.engine.synchronize("list"); expect(f.writes).toEqual([]); expect(f.commits).toHaveLength(1);
  });
  it("merges remote completion with local title edit", async () => {
    const base = localFields(task()); const local = { ...task(), text: "Edited" };
    const f = fixture({ local, mapping: { googleId: "g", base }, remote: { id: "g", ...base, status: "completed", etag: "v1" } });
    await f.engine.synchronize("list"); expect(f.writes[0].task.title).toBe("Edited");
    expect(f.writes[0].task.status).toBe("completed"); expect(f.writes[0].etag).toBe("v1");
  });
  it("preserves local changes to the same field", async () => {
    const base = localFields(task()); const f = fixture({ local: { ...task(), text: "Local" }, mapping: { googleId: "g", base }, remote: { id: "g", ...base, title: "Remote" } });
    await f.engine.synchronize("list"); expect(f.writes[0].task.title).toBe("Local");
  });
  it("propagates remote deletion for an unchanged local task", async () => {
    const f = fixture({ mapping: { googleId: "g", base: localFields(task()) }, remote: { id: "g", deleted: true } });
    await f.engine.synchronize("list"); expect(f.commits[0].next).toBeUndefined(); expect(f.writes).toEqual([]);
  });
  it("recreates a remotely deleted task with unsynced local edits", async () => {
    const f = fixture({ local: { ...task(), desc: "Unsynced" }, mapping: { googleId: "g", base: localFields(task()) }, remote: { id: "g", deleted: true } });
    await f.engine.synchronize("list"); expect(f.writes[0].action).toBe("create");
  });
  it("propagates local deletion with the latest remote etag", async () => {
    const f = fixture({ local: null, mapping: { googleId: "g", base: localFields(task()) }, remote: { id: "g", etag: "v2" } });
    await f.engine.synchronize("list"); expect(f.writes[0]).toMatchObject({ action: "delete", taskId: "g", etag: "v2" });
  });
  it("imports undated completed tasks without manufacturing a Google due date", async () => {
    const f = fixture({ local: null, remote: { id: "g", title: "Phone", status: "completed" } });
    await f.engine.synchronize("list"); const next = f.commits[0].next;
    expect(next.listId).toBe("20260919"); expect(next.checked).toBe(true); expect(localFields(next).due).toBeNull();
  });
  it("does not acknowledge failed writes", async () => {
    const f = fixture(); f.transport.write = async () => { throw new Error("offline"); };
    await expect(f.engine.synchronize("list")).rejects.toThrow("offline"); expect(f.commits).toEqual([]);
  });
  it("does not delete tasks assigned from Docs or Chat", async () => {
    const f = fixture({ local: null, remote: { id: "g", assignmentInfo: {} } });
    await f.engine.synchronize("list"); expect(f.writes).toEqual([]); expect(f.commits).toEqual([]);
  });
  it("strips only its trailing recovery marker from notes", () => {
    expect(remoteFields({ notes: "Hello\n\n[WeekToDo:local-1]" }).notes).toBe("Hello");
  });
});
