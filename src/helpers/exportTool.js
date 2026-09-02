import storageRepository from "../repositories/storageRepository";
import dbRepository from "../repositories/dbRepository";
import { Toast, Modal } from "bootstrap";
import migrations from "../migrations/migrations";
import desktop, { isDesktop } from "./desktop";
import { parseBackup, serializeBackup } from "./backupFormat";

export default {
  export() {
    var filename = "WeekToDoBackup.wtdb";
    var data = storageRepository.as_json();
    data.backupVersion = 2;
    data.todoLists = {};
    data.repeating_events = {};
    data.repeating_events_by_date = {};
    let db_req = dbRepository.open();

    db_req.onsuccess = function (event) {
      var db = event.target.result;
      let request = dbRepository.selectAll(db, "todo_lists");
      request.onsuccess = function () {
        let cursor = request.result;
        if (cursor) {
          data.todoLists[cursor.key] = cursor.value;
          cursor.continue();
        } else {
          getRepeatinEventData(filename, data, event);
        }
      };
    };
  },
  import(event) {
    let fr = readFile(event.target.files);
    fr.onload = async function () {
      var toast = new Toast(document.getElementById("invalidFile"));
      try {
        await importData(parseBackup(fr.result));
        migrations.migrate();
        location.reload();
      } catch {
        toast.show();
      }
    };
  },
  clear() {
    if (isDesktop()) {
      desktop.clearDesktopConfig();
    }

    storageRepository.clean();
    let db_req = dbRepository.open();
    db_req.onsuccess = function (event) {
      var db = event.target.result;
      const transaction=dbRepository.clearApplicationData(db);transaction.oncomplete=()=>{db.close();location.reload();};
    };
  },
};

function getRepeatinEventData(filename, data, event) {
  var db = event.target.result;
  let request = dbRepository.selectAll(db, "repeating_events");
  request.onsuccess = function () {
    let cursor = request.result;
    if (cursor) {
      data.repeating_events[cursor.key] = cursor.value;
      cursor.continue();
    } else {
      getRepeatinEventByDateData(filename, data, event);
    }
  };
}

function getRepeatinEventByDateData(filename, data, event) {
  var db = event.target.result;
  let request = dbRepository.selectAll(db, "repeating_events_by_date");
  request.onsuccess = function () {
    let cursor = request.result;
    if (cursor) {
      data.repeating_events_by_date[cursor.key] = cursor.value;
      cursor.continue();
    } else {
      let string_data = serializeBackup(data);
      createExportLink(filename, string_data);
    }
  };
}

function createExportLink(filename, fileBody) {
  var element = document.createElement("a");
  element.setAttribute("href", "data:text/plain;charset=utf-8," + encodeURIComponent(fileBody));
  element.setAttribute("download", filename);
  element.style.display = "none";
  document.body.appendChild(element);
  element.click();
  document.body.removeChild(element);
  setTimeout(function () {
    let exportingModal = Modal.getInstance(document.getElementById("exportingModal"));
    exportingModal.hide();
  },1000);
}

function readFile(files) {
  const fileList = files;
  var fr = null;
  if (fileList[0]) {
    fr = new FileReader();
    fr.readAsText(fileList[0]);
  }
  return fr;
}

function importData(data) {
  return new Promise((resolve,reject)=>{const request=dbRepository.open();request.onerror=()=>reject(request.error);
    request.onsuccess=(event)=>{const db=event.target.result;const transaction=dbRepository.importBackup(db,data);
      transaction.oncomplete=()=>{db.close();importLocalStorageData(data);resolve();};
      transaction.onerror=()=>{db.close();reject(transaction.error);};transaction.onabort=()=>{db.close();reject(transaction.error);};};});
}

function importLocalStorageData(data) {
  storageRepository.clean();
  storageRepository.load_json(data);
}

