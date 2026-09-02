import dbRepository from "./dbRepository";
import { createSyncOperation, prepareEntity } from "../sync/syncModel";
import { getDeviceId } from "../sync/deviceIdentity";

export default {
  update(repeatingEventId, repeatingEvent) {
    let db_req = dbRepository.open();
    db_req.onsuccess = function (event) {
      let db = event.target.result;
      const request = dbRepository.get(db, "repeating_events", repeatingEventId);
      request.onsuccess = () => {
        const prepared = prepareEntity(repeatingEvent, request.result);
        dbRepository.updateWithOutbox(db, "repeating_events", repeatingEventId, prepared, [
          createSyncOperation("repeating_event", prepared, "upsert", undefined, getDeviceId(),request.result),
        ]);
      };
    };
  },
  remove(repeatingEventId) {
    let db_req = dbRepository.open();
    db_req.onsuccess = function (event) {
      let db = event.target.result;
      const request = dbRepository.get(db, "repeating_events", repeatingEventId);
      request.onsuccess = () => {
        if (!request.result) return dbRepository.delete(db, "repeating_events", repeatingEventId);
        const deleted = prepareEntity(request.result, request.result);
        deleted._sync.deletedAt = new Date().toISOString();
        deleted._sync.localRevision += 1;
        dbRepository.deleteWithOutbox(db, "repeating_events", repeatingEventId, [
          createSyncOperation("repeating_event", deleted, "delete", undefined, getDeviceId(),request.result),
        ]);
      };
    };
  },
};
