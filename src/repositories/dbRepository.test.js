import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import dbRepository from "./dbRepository";

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

describe("sync-ready IndexedDB schema", () => {
  beforeEach(async () => {
    await requestResult(indexedDB.deleteDatabase("weekToDo"));
  });

  it("creates the outbox and commits entity changes with their operation atomically", async () => {
    const db = await requestResult(dbRepository.open());
    expect([...db.objectStoreNames]).toEqual(
      expect.arrayContaining(["todo_lists", "repeating_events", "sync_metadata", "sync_outbox","sync_history",
        "sync_conflicts","sync_tombstones"])
    );

    const operation = { operationId: "op-1", entityId: "task-1", createdAt: "2026-08-31T00:00:00.000Z" };
    await transactionDone(dbRepository.updateWithOutbox(db, "todo_lists", "today", [{ text: "Task" }], [operation]));

    expect(await requestResult(dbRepository.get(db, "todo_lists", "today"))).toEqual([{ text: "Task" }]);
    expect(await requestResult(dbRepository.listOutbox(db))).toEqual([operation]);
    db.close();
  });

  it("rolls back outbox replacement, conflict records, and history when recovery is interrupted",async()=>{
    const db=await requestResult(dbRepository.open());const original={operationId:"old-op",entityId:"task-1",createdAt:"2026-01-01"};
    await transactionDone(dbRepository.enqueueOutbox(db,[original]));
    const resolution={operationId:"old-op",operations:[{operationId:"retry-op",entityId:"task-1",createdAt:"2026-01-02"}],
      history:[{id:"history-1",entityType:"task",entityId:"task-1",createdAt:"2026-01-02"}],
      record:{id:"conflict-1",entityKey:"task:task-1",createdAt:"2026-01-02"}};
    const transaction=dbRepository.resolveSyncConflicts(db,[resolution]);const aborted=new Promise((resolve)=>{transaction.onabort=resolve;});
    transaction.abort();await aborted;
    expect(await requestResult(dbRepository.listOutbox(db))).toEqual([original]);
    expect(await requestResult(dbRepository.listSyncHistory(db,"task:task-1"))).toEqual([]);
    expect(await requestResult(dbRepository.listSyncConflicts(db))).toEqual([]);db.close();
  });

  it("prunes only expired local tombstone payloads",async()=>{
    const db=await requestResult(dbRepository.open());const seed=db.transaction(["sync_tombstones"],"readwrite");
    seed.objectStore("sync_tombstones").put({entityKey:"task:old",expiresAt:"2026-01-01"});
    seed.objectStore("sync_tombstones").put({entityKey:"task:new",expiresAt:"2027-01-01"});await transactionDone(seed);
    await transactionDone(dbRepository.pruneSyncTombstones(db,"2026-06-01"));
    expect(await requestResult(db.transaction(["sync_tombstones"],"readonly").objectStore("sync_tombstones").getAll()))
      .toEqual([{entityKey:"task:new",expiresAt:"2027-01-01"}]);db.close();
  });

  it("imports a backup atomically and clears stale synchronization state",async()=>{
    const db=await requestResult(dbRepository.open());await transactionDone(dbRepository.updateWithOutbox(db,"todo_lists","old",
      [{text:"Old local data"}],[{operationId:"stale-op",createdAt:"2026-01-01"}]));
    await transactionDone(dbRepository.importBackup(db,{todoLists:{today:[{text:"Recovered",_sync:{id:"task-1"}}]},
      repeating_events:{repeat:{id:"repeat"}},repeating_events_by_date:{}}));
    expect(await requestResult(dbRepository.get(db,"todo_lists","old"))).toBeUndefined();
    expect(await requestResult(dbRepository.get(db,"todo_lists","today"))).toMatchObject([{text:"Recovered"}]);
    expect(await requestResult(dbRepository.listOutbox(db))).toEqual([]);db.close();
  });
});
