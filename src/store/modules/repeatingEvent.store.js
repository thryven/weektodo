import dbRepository from "../../repositories/dbRepository";
import { createSyncOperation,prepareEntity } from "../../sync/syncModel";
import { getDeviceId } from "../../sync/deviceIdentity";

const state = {
  repeatingEventList: {},
  repeatingEventByDate: {},
};

const getters = {
  repeatingEventList(state) {
    return state.repeatingEventList;
  },
  repeatingEventByDate(state) {
    return state.repeatingEventByDate;
  },
};

const mutations = {
  loadRepeatingEvent(state, repeatingEvent) {
    state.repeatingEventList[repeatingEvent.id] = repeatingEvent;
  },
  updateRepeatingEvent(state, obj) {
    state.repeatingEventList[obj.key] = obj.val;
  },
  removeRepeatingEvent(state, id) {
    delete state.repeatingEventList[id];
  },
  loadRepeatingEventList(state, repeatingEventList) {
    state.repeatingEventList = repeatingEventList;
  },
  loadRepeatingEventGeneratedByDate(state, obj) {
    state.repeatingEventByDate[obj.key] = obj.val ? obj.val : {};
  },
};

const actions = {
  loadRepeatingEvent({ commit }, repeatingEventId) {
    let db_req = dbRepository.open();

    db_req.onsuccess = function (event) {
      let db = event.target.result;
      var get_req = dbRepository.get(db, "repeating_events", repeatingEventId);

      get_req.onsuccess = function (event) {
        let repeatingEvent = event.target.result;
        if (repeatingEvent) {
          const previous=structuredClone(repeatingEvent);const hadMetadata=Boolean(repeatingEvent._sync);
          repeatingEvent = prepareEntity(repeatingEvent,hadMetadata?repeatingEvent:null);
          if(!hadMetadata)dbRepository.updateWithOutbox(db,"repeating_events",repeatingEventId,repeatingEvent,[
            createSyncOperation("repeating_event",repeatingEvent,"upsert",undefined,getDeviceId(),previous)]);
          else dbRepository.update(db, "repeating_events", repeatingEventId, repeatingEvent);
        }
        commit("loadRepeatingEvent", repeatingEvent);
      };
    };
  },
  loadAllRepeatingEvent({ commit }) {
    return new Promise((resolve) => {
      let db_req = dbRepository.open();
      db_req.onsuccess = function (event) {
        let db = event.target.result;
        const transaction=db.transaction(["repeating_events","sync_outbox"],"readwrite");
        let syncAdded=false;transaction.addEventListener("complete",()=>{if(syncAdded)globalThis.dispatchEvent?.(new Event("weektodo:sync-needed"));});
        let get_req = transaction.objectStore("repeating_events").openCursor();const outbox=transaction.objectStore("sync_outbox");
        var repeatingEvents = {};
        get_req.onsuccess = function () {
          let cursor = get_req.result;
          if (cursor) {
            const previous=structuredClone(cursor.value);const hadMetadata=Boolean(cursor.value._sync);
            const repeatingEvent = prepareEntity(cursor.value,hadMetadata?cursor.value:null);
            repeatingEvents[cursor.key] = repeatingEvent;
            cursor.update(repeatingEvent);
            if(!hadMetadata){syncAdded=true;outbox.put(createSyncOperation("repeating_event",repeatingEvent,"upsert",undefined,getDeviceId(),previous));}
            cursor.continue();
          } else {
            commit("loadRepeatingEventList", repeatingEvents);
            resolve();
          }
        };
      };
    });
  },
  loadRepeatingEventGeneratedByDate({ commit }, date) {
    return new Promise((resolve) => {
      let db_req = dbRepository.open();
      db_req.onsuccess = function (event) {
        let db = event.target.result;
        var get_req = dbRepository.get(db, "repeating_events_by_date", date);
        get_req.onsuccess = function (event) {
          let re_list = event.target.result;
          commit("loadRepeatingEventGeneratedByDate", { key: date, val: re_list });
          resolve();
        };
      };
    });
  },
};

export default {
  namespaced: false,
  state,
  getters,
  actions,
  mutations,
};
