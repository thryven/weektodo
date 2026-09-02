import "fake-indexeddb/auto";
import {beforeEach,describe,expect,it} from "vitest";
import dbRepository from "./dbRepository";
import {commitLocalDocument,LOCAL_WRITE_JOURNAL_PREFIX,recoverPendingLocalWrites} from "./localDocumentSyncRepository";

function requestResult(request){return new Promise((resolve,reject)=>{request.onsuccess=()=>resolve(request.result);
  request.onerror=()=>reject(request.error);});}
function transactionDone(transaction){return new Promise((resolve,reject)=>{transaction.oncomplete=resolve;
  transaction.onerror=()=>reject(transaction.error);transaction.onabort=()=>reject(transaction.error);});}
function memoryStorage(){const values=new Map();return{get:(key)=>values.has(key)?structuredClone(values.get(key)):null,
  set:(key,value)=>values.set(key,structuredClone(value)),remove:(key)=>values.delete(key),values};}

describe("local document synchronization transactions",()=>{
  beforeEach(async()=>{await requestResult(indexedDB.deleteDatabase("weekToDo"));});
  it("commits the durable document shadow and outbox before publishing the local mirror",async()=>{
    const storage=memoryStorage();const operation={operationId:"op-1",entityId:"settings",createdAt:"2026-09-01"};
    await expect(commitLocalDocument("config",{darkTheme:true},[operation],{storage})).resolves.toBe(true);
    expect(storage.get("config")).toEqual({darkTheme:true});expect(storage.get(`${LOCAL_WRITE_JOURNAL_PREFIX}config`)).toBeNull();
    const db=await requestResult(dbRepository.open());expect(await requestResult(dbRepository.listOutbox(db))).toEqual([operation]);
    expect(await requestResult(db.transaction(["sync_local_documents"],"readonly").objectStore("sync_local_documents").get("config")))
      .toMatchObject({key:"config",value:{darkTheme:true}});db.close();
  });
  it("snapshots reactive proxies before entering the persistence boundary",async()=>{
    const storage=memoryStorage();const value=new Proxy({darkTheme:true},{});
    await expect(commitLocalDocument("config",value,[{operationId:"op-proxy",createdAt:"2026-09-01"}],{storage}))
      .resolves.toBe(true);
    expect(storage.get("config")).toEqual({darkTheme:true});
  });
  it("replays a surviving journal after an interrupted mirror publication",async()=>{
    const storage=memoryStorage();const journalKey=`${LOCAL_WRITE_JOURNAL_PREFIX}customTodoListIds`;
    const journal={key:"customTodoListIds",value:[{listId:"one"}],operations:[{operationId:"op-recovered",createdAt:"2026-09-01"}]};
    storage.set(journalKey,journal);const previousLocalStorage=globalThis.localStorage;
    globalThis.localStorage={};Object.defineProperty(globalThis.localStorage,journalKey,{value:"present",enumerable:true,configurable:true});
    try{await recoverPendingLocalWrites({storage});}finally{globalThis.localStorage=previousLocalStorage;}
    expect(storage.get("customTodoListIds")).toEqual([{listId:"one"}]);expect(storage.get(journalKey)).toBeNull();
    const db=await requestResult(dbRepository.open());expect(await requestResult(dbRepository.listOutbox(db)))
      .toMatchObject([{operationId:"op-recovered"}]);await transactionDone(dbRepository.clearSyncState(db));db.close();
  });
  it("serializes rapid writes and leaves the newest document durable",async()=>{
    const storage=memoryStorage();const first=commitLocalDocument("config",{zoom:100},[{operationId:"op-1",createdAt:"1"}],{storage});
    const second=commitLocalDocument("config",{zoom:125},[{operationId:"op-2",createdAt:"2"}],{storage});
    await Promise.all([first,second]);expect(storage.get("config")).toEqual({zoom:125});
    expect(storage.get(`${LOCAL_WRITE_JOURNAL_PREFIX}config`)).toBeNull();const db=await requestResult(dbRepository.open());
    expect((await requestResult(dbRepository.listOutbox(db))).map(({operationId})=>operationId).sort()).toEqual(["op-1","op-2"]);
    expect(await requestResult(db.transaction(["sync_local_documents"],"readonly").objectStore("sync_local_documents").get("config")))
      .toMatchObject({value:{zoom:125}});db.close();
  });
});
