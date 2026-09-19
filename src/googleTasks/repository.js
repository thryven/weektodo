import dbRepository from "../repositories/dbRepository";
import { ensureSyncMetadata, prepareEntity, createSyncOperation } from "../sync/syncModel";

const copy = (value) => JSON.parse(JSON.stringify(value));
export async function transact(work) {
  const db = await new Promise((resolve, reject) => {
    const request = dbRepository.open(); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  });
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(["todo_lists", "google_sync_state", "google_sync_queue", "sync_outbox"], "readwrite");
      let result;
      tx.oncomplete = () => resolve(result);
      tx.onerror = tx.onabort = () => reject(tx.error || new Error("Google sync storage transaction failed"));
      work(tx, (value) => { result = value; });
    });
  } finally { db.close(); }
}

export class GoogleRepository {
  settings() { return transact((tx, done) => {
    const request = tx.objectStore("google_sync_state").get("settings");
    request.onsuccess = () => done(request.result || { listId: "", auto: true, lastSync: null });
  }); }
  configure(settings) { return transact((tx) => tx.objectStore("google_sync_state").put(copy(settings), "settings")); }
  snapshot(listId) { return transact((tx, done) => {
    const lists = {}; const queue = {}; let mappings = {};
    const state = tx.objectStore("google_sync_state").get(`mapping:${listId}`);
    state.onsuccess = () => { mappings = state.result || {}; };
    const queued = tx.objectStore("google_sync_queue").getAll();
    queued.onsuccess = () => queued.result.forEach((entry) => { queue[entry.entityId] = entry; });
    const request = tx.objectStore("todo_lists").openCursor();
    request.onsuccess = () => {
      const cursor = request.result;
      if (cursor) {
        const tasks = cursor.value; let changed = false;
        for (const task of tasks) { if (!task._sync) { ensureSyncMetadata(task); changed = true; } }
        if (changed) cursor.update(tasks);
        lists[cursor.key] = tasks; cursor.continue();
      } else done({ tasks: Object.values(lists).flat(), mappings, queue });
    };
  }); }
  // Compare-and-swap task and queue acknowledgement in one transaction. A newer local
  // write stays queued even when an older network request has just succeeded.
  commit({ listId, id, expected, next, mapping, operationId }) { return transact((tx, done) => {
    const store = tx.objectStore("todo_lists"); const lists = {}; const before = {};
    const request = store.openCursor();
    request.onsuccess = () => {
      const cursor = request.result;
      if (cursor) { lists[cursor.key] = cursor.value; before[cursor.key] = copy(cursor.value); cursor.continue(); return; }
      const current = Object.values(lists).flat().find((task) => task._sync?.id === id);
      const unchanged = JSON.stringify(current) === JSON.stringify(expected);
      if (unchanged && JSON.stringify(next) !== JSON.stringify(current)) {
        for (const key of Object.keys(lists)) lists[key] = lists[key].filter((task) => task._sync?.id !== id);
        if (next) {
          ensureSyncMetadata(next, { id: () => id }); prepareEntity(next, current);
          (lists[next.listId] ||= []).push(next);
        }
        const entity = next || current;
        if (entity) tx.objectStore("sync_outbox").put(copy(createSyncOperation("task", entity, next ? "upsert" : "delete", undefined, null, current)));
        for (const key of Object.keys(lists)) if (JSON.stringify(lists[key]) !== JSON.stringify(before[key])) store.put(copy(lists[key]), key);
      }
      const mappings = tx.objectStore("google_sync_state"); const get = mappings.get(`mapping:${listId}`);
      get.onsuccess = () => { const value = get.result || {}; if (mapping) value[id] = copy(mapping); else delete value[id]; mappings.put(value, `mapping:${listId}`); };
      const queue = tx.objectStore("google_sync_queue"); const pending = queue.get(id);
      pending.onsuccess = () => { if (pending.result?.operationId === operationId && unchanged) queue.delete(id); };
      done({ before, lists, changed: unchanged });
    };
  }); }
}
