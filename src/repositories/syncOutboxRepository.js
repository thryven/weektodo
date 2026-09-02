import dbRepository from "./dbRepository";

function withDatabase(run) {
  return new Promise((resolve, reject) => {
    const request = dbRepository.open();
    request.onerror = () => reject(request.error);
    request.onsuccess = async (event) => {
      const db = event.target.result;
      try {
        resolve(await run(db));
      } catch (error) {
        reject(error);
      } finally {
        db.close();
      }
    };
  });
}

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

export function enqueueSyncOperations(operations) {
  if (!operations.length) return Promise.resolve();
  return withDatabase((db) => transactionDone(dbRepository.enqueueOutbox(db, operations))).then(() => {
    globalThis.dispatchEvent?.(new Event("weektodo:sync-needed"));
  });
}

export function loadSyncOutbox() {
  return withDatabase((db) => requestResult(dbRepository.listOutbox(db)));
}

export function acknowledgeSyncOperations(operationIds) {
  if (!operationIds.length) return Promise.resolve();
  return withDatabase((db) => transactionDone(dbRepository.removeOutbox(db, operationIds)));
}

export function markSyncOperationsFailed(operations, error, now = Date.now()) {
  const failed = operations.map((operation) => {
    const attempts = (operation.attempts || 0) + 1;
    return {
      ...operation,
      attempts,
      lastError: String(error?.message || error),
      nextAttemptAt: new Date(now + Math.min(2 ** attempts * 1000, 5 * 60 * 1000)).toISOString(),
    };
  });
  return withDatabase((db) => transactionDone(dbRepository.updateOutbox(db, failed)));
}

export function getSyncMetadata(key) {
  return withDatabase((db) => requestResult(dbRepository.getSyncMetadata(db, key)));
}

export function setSyncMetadata(key, value) {
  return withDatabase((db) => transactionDone(dbRepository.setSyncMetadata(db, key, value)));
}

export function resolveSyncConflicts(resolutions) {
  if(!resolutions.length)return Promise.resolve();
  return withDatabase((db)=>transactionDone(dbRepository.resolveSyncConflicts(db,resolutions))).then(()=>{
    globalThis.dispatchEvent?.(new Event("weektodo:sync-needed"));
  });
}

export function loadSyncHistory(entityType,entityId) {
  return withDatabase((db)=>requestResult(dbRepository.listSyncHistory(db,`${entityType}:${entityId}`)));
}

export function loadSyncConflicts() { return withDatabase((db)=>requestResult(dbRepository.listSyncConflicts(db))); }
export function markSyncConflictResolved(id,resolvedAt=new Date().toISOString()) {
  return withDatabase((db)=>transactionDone(dbRepository.resolveSyncConflictRecord(db,id,resolvedAt)));
}
export function pruneSyncTombstones(expiresAt=new Date().toISOString()) {
  return withDatabase((db)=>transactionDone(dbRepository.pruneSyncTombstones(db,expiresAt)));
}
