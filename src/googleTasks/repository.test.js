import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import dbRepository from "../repositories/dbRepository";
import { GoogleRepository, transact } from "./repository";
import { createSyncOperation, ensureSyncMetadata } from "../sync/syncModel";

const repository = new GoogleRepository();
const task = () => ensureSyncMetadata({ text: "Local", checked: false, desc: "", listId: "20260919" }, { id: () => "local-1" });
beforeEach(async () => {
  await transact((tx) => { for (const store of ["todo_lists", "google_sync_state", "google_sync_queue", "sync_outbox"]) tx.objectStore(store).clear(); });
});
describe("durable Google queue", () => {
  it("writes task and independent Google operation atomically", async () => {
    const local = task(); const operation = createSyncOperation("task", local);
    const db = await new Promise((resolve) => { const request = dbRepository.open(); request.onsuccess = () => resolve(request.result); });
    await new Promise((resolve, reject) => { const tx = dbRepository.updateWithOutbox(db, "todo_lists", local.listId, [local], [operation]); tx.oncomplete = resolve; tx.onerror = reject; }); db.close();
    const freshRepository = new GoogleRepository();
    const snapshot = await freshRepository.snapshot("list"); expect(snapshot.queue[local._sync.id].operationId).toBe(operation.operationId);
    expect(snapshot.tasks[0].text).toBe("Local");
  });
  it("preserves a newer local edit and its queue entry during an in-flight sync", async () => {
    const expected = task(); const nextLocal = { ...expected, text: "Newer edit" };
    await transact((tx) => { tx.objectStore("todo_lists").put([nextLocal], nextLocal.listId); tx.objectStore("google_sync_queue").put({ entityId: "local-1", operationId: "new" }); });
    await repository.commit({ listId: "list", id: "local-1", expected, next: { ...expected, text: "Remote" }, mapping: { googleId: "g", base: {} }, operationId: "old" });
    const snapshot = await repository.snapshot("list"); expect(snapshot.tasks[0].text).toBe("Newer edit"); expect(snapshot.queue["local-1"].operationId).toBe("new");
    expect(snapshot.mappings["local-1"].googleId).toBe("g");
  });
  it("atomically applies remote completion, records mapping, and acknowledges only its operation", async () => {
    const expected = task();
    await transact((tx) => { tx.objectStore("todo_lists").put([expected], expected.listId); tx.objectStore("google_sync_queue").put({ entityId: "local-1", operationId: "op" }); });
    await repository.commit({ listId: "list", id: "local-1", expected, next: { ...expected, checked: true }, mapping: { googleId: "g" }, operationId: "op" });
    const snapshot = await repository.snapshot("list"); expect(snapshot.tasks[0].checked).toBe(true); expect(snapshot.queue).toEqual({});
  });
});
