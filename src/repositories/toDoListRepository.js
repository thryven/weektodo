import dbRepository from "./dbRepository";
import { createSyncOperation, prepareTaskList } from "../sync/syncModel";
import { getDeviceId } from "../sync/deviceIdentity";

export default {
  update(toDoListId, toDoList) {
    let db_req = dbRepository.open();
    db_req.onsuccess = function (event) {
      let db = event.target.result;
      const request = dbRepository.get(db, "todo_lists", toDoListId);
      request.onsuccess = () => {
        const prepared = prepareTaskList(toDoList, request.result || []);
        const deviceId = getDeviceId();
        const operations = prepared.changed.map((task) => createSyncOperation("task", task, "upsert", undefined, deviceId,
          prepared.baseById.get(task._sync.id)));
        operations.push(...prepared.deletions.map((task) => createSyncOperation("task", task, "delete", undefined, deviceId,
          prepared.baseById.get(task._sync.id))));
        dbRepository.updateWithOutbox(db, "todo_lists", toDoListId, prepared.tasks, operations);
      };
    };
  },
  remove(toDoListId) {
    let db_req = dbRepository.open();
    db_req.onsuccess = function (event) {
      let db = event.target.result;
      const request = dbRepository.get(db, "todo_lists", toDoListId);
      request.onsuccess = () => {
        const prepared = prepareTaskList([], request.result || []);
        const deviceId = getDeviceId();
        const operations = prepared.deletions.map((task) => createSyncOperation("task", task, "delete", undefined, deviceId,
          prepared.baseById.get(task._sync.id)));
        dbRepository.deleteWithOutbox(db, "todo_lists", toDoListId, operations);
      };
    };
  },
};
