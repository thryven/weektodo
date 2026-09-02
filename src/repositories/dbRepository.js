function signalSyncWhenCommitted(transaction) {
    transaction.addEventListener("complete",()=>globalThis.dispatchEvent?.(new Event("weektodo:sync-needed")));
    return transaction;
}

export default {
    open() {
        var req = indexedDB.open('weekToDo', 7);
        req.onupgradeneeded = function (event) {
            var db = event.target.result;
            if (!db.objectStoreNames.contains("todo_lists")) {
                db.createObjectStore('todo_lists', {autoIncrement: false});
            }

            if (!db.objectStoreNames.contains("repeating_events")) {
                db.createObjectStore('repeating_events', {autoIncrement: false});
            }

            if (!db.objectStoreNames.contains("repeating_events_by_date")) {
                db.createObjectStore('repeating_events_by_date', {autoIncrement: false});
            }
            if (!db.objectStoreNames.contains("sync_outbox")) {
                const outbox = db.createObjectStore("sync_outbox", { keyPath: "operationId" });
                outbox.createIndex("createdAt", "createdAt", { unique: false });
            }
            if (!db.objectStoreNames.contains("sync_metadata")) {
                db.createObjectStore("sync_metadata", { autoIncrement: false });
            }
            if (!db.objectStoreNames.contains("sync_history")) {
                const history=db.createObjectStore("sync_history",{keyPath:"id"});
                history.createIndex("entityKey","entityKey",{unique:false});history.createIndex("createdAt","createdAt",{unique:false});
            }
            if (!db.objectStoreNames.contains("sync_conflicts")) {
                const conflicts=db.createObjectStore("sync_conflicts",{keyPath:"id"});
                conflicts.createIndex("entityKey","entityKey",{unique:false});conflicts.createIndex("createdAt","createdAt",{unique:false});
            }
            if (!db.objectStoreNames.contains("sync_tombstones")) {
                const tombstones=db.createObjectStore("sync_tombstones",{keyPath:"entityKey"});
                tombstones.createIndex("expiresAt","expiresAt",{unique:false});
            }
            if (!db.objectStoreNames.contains("sync_local_documents")) {
                db.createObjectStore("sync_local_documents",{keyPath:"key"});
            }
        }
        req.onerror = function (event) {
            console.log('error opening database ' + event.target.errorCode);
        }
        return req;
    },
    get(db, table, id) {
        let tx = db.transaction([table], 'readonly');
        let store = tx.objectStore(table);
        let req = store.get(id);
        return req;
    },
    add(db, table, id, obj) {
        let tx = db.transaction([table], 'readwrite');
        let store = tx.objectStore(table);
        let req = store.add(obj, id);
        return req;
    },
    update(db, table, id, obj) {
        let tx = db.transaction([table], 'readwrite');
        let store = tx.objectStore(table);
        let new_obj = JSON.parse(JSON.stringify(obj));
        let req = store.put(new_obj,id);
        return req;
    },
    delete(db, table, id) {
        let tx = db.transaction([table], 'readwrite');
        let store = tx.objectStore(table);
        let req = store.delete(id);
        return req;
    },
    selectAll(db, table){
        let tx = db.transaction([table], 'readwrite');
        let store = tx.objectStore(table);
        let req = store.openCursor();
        return req;
    },
    clear(db, table){
        let tx = db.transaction([table], 'readwrite');
        let store = tx.objectStore(table);
        let req = store.clear();
        return req;
    },
    updateWithOutbox(db, table, id, value, operations) {
        const tx = db.transaction([table, "sync_outbox"], "readwrite");
        tx.objectStore(table).put(JSON.parse(JSON.stringify(value)), id);
        const outbox = tx.objectStore("sync_outbox");
        operations.forEach((operation) => outbox.put(JSON.parse(JSON.stringify(operation))));
        return signalSyncWhenCommitted(tx);
    },
    deleteWithOutbox(db, table, id, operations) {
        const tx = db.transaction([table, "sync_outbox"], "readwrite");
        tx.objectStore(table).delete(id);
        const outbox = tx.objectStore("sync_outbox");
        operations.forEach((operation) => outbox.put(JSON.parse(JSON.stringify(operation))));
        return signalSyncWhenCommitted(tx);
    },
    listOutbox(db) {
        return db.transaction(["sync_outbox"], "readonly").objectStore("sync_outbox").getAll();
    },
    enqueueOutbox(db, operations) {
        const tx = db.transaction(["sync_outbox"], "readwrite");
        const outbox = tx.objectStore("sync_outbox");
        operations.forEach((operation) => outbox.put(JSON.parse(JSON.stringify(operation))));
        return tx;
    },
    commitLocalDocument(db,key,value,operations) {
        const tx=db.transaction(["sync_local_documents","sync_outbox"],"readwrite");
        tx.objectStore("sync_local_documents").put({key,value:JSON.parse(JSON.stringify(value)),updatedAt:new Date().toISOString()});
        const outbox=tx.objectStore("sync_outbox");operations.forEach((operation)=>outbox.put(JSON.parse(JSON.stringify(operation))));
        return tx;
    },
    clearSyncState(db) {
        const stores=["sync_outbox","sync_metadata","sync_history","sync_conflicts","sync_tombstones","sync_local_documents"];
        const tx=db.transaction(stores,"readwrite");stores.forEach((name)=>tx.objectStore(name).clear());return tx;
    },
    clearApplicationData(db) {
        const stores=[...db.objectStoreNames];const tx=db.transaction(stores,"readwrite");
        stores.forEach((name)=>tx.objectStore(name).clear());return tx;
    },
    importBackup(db,data) {
        const primary=["todo_lists","repeating_events","repeating_events_by_date"];
        const sync=["sync_outbox","sync_metadata","sync_history","sync_conflicts","sync_tombstones","sync_local_documents"];
        const tx=db.transaction([...primary,...sync],"readwrite");[...primary,...sync].forEach((name)=>tx.objectStore(name).clear());
        Object.entries(data.todoLists||{}).forEach(([key,value])=>tx.objectStore("todo_lists").put(JSON.parse(JSON.stringify(value)),key));
        Object.entries(data.repeating_events||{}).forEach(([key,value])=>tx.objectStore("repeating_events").put(JSON.parse(JSON.stringify(value)),key));
        Object.entries(data.repeating_events_by_date||{}).forEach(([key,value])=>
            tx.objectStore("repeating_events_by_date").put(JSON.parse(JSON.stringify(value)),key));return tx;
    },
    removeOutbox(db, operationIds) {
        const tx = db.transaction(["sync_outbox"], "readwrite");
        const outbox = tx.objectStore("sync_outbox");
        operationIds.forEach((operationId) => outbox.delete(operationId));
        return tx;
    },
    updateOutbox(db, operations) {
        return this.enqueueOutbox(db, operations);
    },
    getSyncMetadata(db, key) {
        return db.transaction(["sync_metadata"], "readonly").objectStore("sync_metadata").get(key);
    },
    setSyncMetadata(db, key, value) {
        const tx = db.transaction(["sync_metadata"], "readwrite");
        tx.objectStore("sync_metadata").put(JSON.parse(JSON.stringify(value)), key);
        return tx;
    },
    resolveSyncConflicts(db,resolutions) {
        const tx=db.transaction(["sync_outbox","sync_history","sync_conflicts"],"readwrite");
        const outbox=tx.objectStore("sync_outbox");const history=tx.objectStore("sync_history");const conflicts=tx.objectStore("sync_conflicts");
        resolutions.forEach((resolution)=>{outbox.delete(resolution.operationId);
            resolution.operations.forEach((operation)=>outbox.put(JSON.parse(JSON.stringify(operation))));
            resolution.history.forEach((entry)=>history.put({...JSON.parse(JSON.stringify(entry)),entityKey:`${entry.entityType}:${entry.entityId}`}));
            conflicts.put(JSON.parse(JSON.stringify(resolution.record)));
        });return tx;
    },
    listSyncHistory(db,entityKey) {
        return db.transaction(["sync_history"],"readonly").objectStore("sync_history").index("entityKey").getAll(entityKey);
    },
    listSyncConflicts(db) { return db.transaction(["sync_conflicts"],"readonly").objectStore("sync_conflicts").getAll(); },
    resolveSyncConflictRecord(db,id,resolvedAt) { const tx=db.transaction(["sync_conflicts"],"readwrite");
        const store=tx.objectStore("sync_conflicts");const request=store.get(id);request.onsuccess=()=>{if(request.result)
            store.put({...request.result,resolvedAt});};return tx; },
    pruneSyncTombstones(db,expiresAt) {
        const tx=db.transaction(["sync_tombstones"],"readwrite");const request=tx.objectStore("sync_tombstones")
            .index("expiresAt").openCursor(IDBKeyRange.upperBound(expiresAt));request.onsuccess=()=>{const cursor=request.result;
            if(cursor){cursor.delete();cursor.continue();}};return tx;
    },
    getAll(db, table) {
        return db.transaction([table], "readonly").objectStore(table).getAll();
    },
    getAllKeys(db, table) {
        return db.transaction([table], "readonly").objectStore(table).getAllKeys();
    }
};
