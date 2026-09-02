import dbRepository from "../repositories/dbRepository";
import storageRepository from "../repositories/storageRepository";
import { acknowledgeSyncOperations, getSyncMetadata, loadSyncOutbox, markSyncOperationsFailed,
  pruneSyncTombstones,resolveSyncConflicts, setSyncMetadata } from "../repositories/syncOutboxRepository";

const TOMBSTONE_RETENTION_MS=90*24*60*60*1000;

function recordRecovery(transaction,change) {
  const createdAt=new Date().toISOString();const entityKey=`${change.entityType}:${change.entityId}`;
  transaction.objectStore("sync_history").put({id:crypto.randomUUID(),entityKey,entityType:change.entityType,
    entityId:change.entityId,serverRevision:change.serverRevision,source:"remote",payload:structuredClone(change.payload),createdAt});
  const tombstones=transaction.objectStore("sync_tombstones");
  if(change.action==="delete")tombstones.put({entityKey,entityType:change.entityType,entityId:change.entityId,
    serverRevision:change.serverRevision,deletedAt:change.payload?._sync?.deletedAt||createdAt,
    expiresAt:new Date(Date.now()+TOMBSTONE_RETENTION_MS).toISOString(),payload:structuredClone(change.payload)});
  else tombstones.delete(entityKey);
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = dbRepository.open();
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

async function applyTaskChange(change) {
  const db = await openDatabase();
  const transaction = db.transaction(["todo_lists","sync_history","sync_tombstones"], "readwrite");
  recordRecovery(transaction,change);
  const store = transaction.objectStore("todo_lists");
  const request = store.openCursor();
  request.onsuccess = () => {
    const cursor = request.result;
    if (!cursor) {
      if (change.action !== "delete") {
        const getTarget = store.get(change.payload.listId);
        getTarget.onsuccess = () => {
          const target = getTarget.result || [];
          if (!target.some((task) => task._sync?.id === change.entityId)) target.push(change.payload);
          store.put(target, change.payload.listId);
        };
      }
      return;
    }
    const filtered = cursor.value.filter((task) => task._sync?.id !== change.entityId);
    if (filtered.length !== cursor.value.length) cursor.update(filtered);
    cursor.continue();
  };
  await transactionDone(transaction);
  db.close();
}

async function applyRepeatingEventChange(change) {
  const db = await openDatabase();
  const key = change.payload.id || change.entityId;
  const transaction = db.transaction(["repeating_events","sync_history","sync_tombstones"], "readwrite");
  recordRecovery(transaction,change);
  const store = transaction.objectStore("repeating_events");
  if (change.action === "delete") store.delete(key);
  else store.put(change.payload, key);
  await transactionDone(transaction);
  db.close();
}

function applyLocalStorageChange(change) {
  if (change.entityType === "custom_list") {
    const lists = storageRepository.get("customTodoListIds") || [];
    const filtered = lists.filter((list) => list._sync?.id !== change.entityId);
    if (change.action !== "delete") filtered.push(change.payload);
    storageRepository.set("customTodoListIds", filtered);
  } else if (change.entityType === "settings" && change.action !== "delete") {
    const current = storageRepository.get("config") || {};
    const { _sync, ...shared } = change.payload;
    storageRepository.set("config", { ...current, ...shared });
    storageRepository.set("syncSharedSettingsMetadata", _sync);
  }
}

async function recordLocalStorageRecovery(change) {
  const db=await openDatabase();const transaction=db.transaction(["sync_history","sync_tombstones"],"readwrite");
  recordRecovery(transaction,change);await transactionDone(transaction);db.close();
}

export class IndexedDbSyncStorage {
  loadOutbox() { return loadSyncOutbox(); }
  acknowledge(ids) { return acknowledgeSyncOperations(ids); }
  markFailed(operations, error, now) { return markSyncOperationsFailed(operations, error, now); }
  getMetadata(key) { return getSyncMetadata(key); }
  setMetadata(key, value) { return setSyncMetadata(key, value); }
  resolveConflicts(resolutions) { return resolveSyncConflicts(resolutions); }
  pruneTombstones(expiresAt) { return pruneSyncTombstones(expiresAt); }

  async applyChanges(changes) {
    for (const change of changes) {
      if (change.entityType === "task") await applyTaskChange(change);
      else if (change.entityType === "repeating_event") await applyRepeatingEventChange(change);
      else {await recordLocalStorageRecovery(change);applyLocalStorageChange(change);}
    }
  }
}
