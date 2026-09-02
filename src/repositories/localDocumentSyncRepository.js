import dbRepository from "./dbRepository";
import storageRepository from "./storageRepository";

export const LOCAL_WRITE_JOURNAL_PREFIX="weektodo.pending-local-write.";
const documentQueues=new Map();

function jsonSnapshot(value) {
  return JSON.parse(JSON.stringify(value));
}

function requestDatabase() {
  return new Promise((resolve,reject)=>{const request=dbRepository.open();request.onsuccess=()=>resolve(request.result);
    request.onerror=()=>reject(request.error);});
}

function transactionDone(transaction) {
  return new Promise((resolve,reject)=>{transaction.oncomplete=resolve;transaction.onerror=()=>reject(transaction.error);
    transaction.onabort=()=>reject(transaction.error||new Error("Local document transaction aborted"));});
}

async function persistJournal(journal) {
  const db=await requestDatabase();try{await transactionDone(dbRepository.commitLocalDocument(db,journal.key,journal.value,journal.operations));}
  finally{db.close();}
}

export function commitLocalDocument(key,value,operations,{storage=storageRepository}={}) {
  const journalKey=`${LOCAL_WRITE_JOURNAL_PREFIX}${key}`;const journal={id:crypto.randomUUID(),key,value:jsonSnapshot(value),
    operations:jsonSnapshot(operations),createdAt:new Date().toISOString()};storage.set(journalKey,journal);storage.set(key,journal.value);
  const previous=documentQueues.get(key)||Promise.resolve();const current=previous.catch(()=>{}).then(async()=>{
    try{await persistJournal(journal);if(storage.get(journalKey)?.id===journal.id)storage.remove(journalKey);
      globalThis.dispatchEvent?.(new Event("weektodo:sync-needed"));return true;}
    catch{return false;}
  });documentQueues.set(key,current);current.finally(()=>{if(documentQueues.get(key)===current)documentQueues.delete(key);});return current;
}

export function recoverPendingLocalWrites({storage=storageRepository}={}) {
  const keys=Object.keys(localStorage).filter((key)=>key.startsWith(LOCAL_WRITE_JOURNAL_PREFIX));
  const recoveries=keys.map((journalKey)=>{const journal=storage.get(journalKey);if(!journal?.key)return Promise.resolve(false);
    storage.set(journal.key,journal.value);return persistJournal(journal).then(()=>{storage.remove(journalKey);
      globalThis.dispatchEvent?.(new Event("weektodo:sync-needed"));return true;}).catch(()=>false);});
  return Promise.all(recoveries);
}
