import storageRepository from "./storageRepository";
import { createSyncOperation, prepareTaskList } from "../sync/syncModel";
import { getDeviceId } from "../sync/deviceIdentity";
import { commitLocalDocument } from "./localDocumentSyncRepository";

export default {
    load() {
        let customToDoList = storageRepository.get('customTodoListIds');
        if (customToDoList) {
            const prepared = prepareTaskList(customToDoList, customToDoList);
            if(prepared.changed.length){const deviceId=getDeviceId();commitLocalDocument('customTodoListIds',prepared.tasks,
                prepared.changed.map((list)=>createSyncOperation("custom_list",list,"upsert",undefined,deviceId,
                    prepared.baseById.get(list._sync.id))));}
            else storageRepository.set('customTodoListIds', prepared.tasks);
            return prepared.tasks;
        } else {
            storageRepository.set('customTodoListIds', []);
            return [];
        }
    },
    update(customToDoList) {
        const previous = storageRepository.get('customTodoListIds') || [];
        const prepared = prepareTaskList(customToDoList, previous);
        const deviceId = getDeviceId();
        return commitLocalDocument('customTodoListIds',prepared.tasks,[
            ...prepared.changed.map((list) => createSyncOperation("custom_list", list, "upsert", undefined, deviceId,
              prepared.baseById.get(list._sync.id))),
            ...prepared.deletions.map((list) => createSyncOperation("custom_list", list, "delete", undefined, deviceId,
              prepared.baseById.get(list._sync.id))),
        ]);
    }
};
