import storageRepository from "./storageRepository";
import version_json from "../../public/version.json";
import moment from "moment";
import { createSyncOperation } from "../sync/syncModel";
import { prepareSharedSettings, sharedSettings } from "../sync/syncSettings";
import { getDeviceId } from "../sync/deviceIdentity";
import { commitLocalDocument } from "./localDocumentSyncRepository";

const SETTINGS_METADATA_KEY = "syncSharedSettingsMetadata";

export default {
  load() {
    let config = storageRepository.get("config");
    if (config) {
      return config;
    } else {
      let default_config = {
        darkTheme: false,
        customList: true,
        calendar: true,
        firstTimeOpen: true,
        language: "en",
        version: version_json.version,
        checkUpdates: true,
        columns: 5,
        customColumns: 5,
        zoom: 100,
        calendarHeight: "calc(50% - 50px)",
        notificationOnStartup: true,
        notificationSound: "pop",
        openOnStartup: true,
        runInBackground: true,
        moveOldTasks: true,
        dateToShowInitialDonateModal: moment().add(15, "d").format("YYYY-MM-DD"),
        InitialDonateModalShown: false,
        mainDividerPosition: 1,
        darkTrayIcon: false,
        importing: false,
        compactView: true,
        startCalendarYesterday: false,
        notificationIndicator: true,
        autoReorderTasks: false,
        moveCompletedTaskToBottom: true,
        moveCompletedSubTaskToBottom: true,
        fullscreenToDoModal: false,
        weekStartOnMonday: true,
        lastDayOpened: moment().format("YYYY-MM-DD")
      };
      storageRepository.set("config", default_config);
      return default_config;
    }
  },
  update(config) {
    const previous = storageRepository.get("config");
    const metadata = storageRepository.get(SETTINGS_METADATA_KEY);
    const prepared = prepareSharedSettings(config, previous, metadata);
    storageRepository.set(SETTINGS_METADATA_KEY, prepared._sync);
    if (!previous || prepared._sync.localRevision !== metadata?.localRevision) {
      return commitLocalDocument("config",config,[
        createSyncOperation("settings", prepared, "upsert", undefined, getDeviceId(),previous ? {...sharedSettings(previous),_sync:metadata} : null),
      ]);
    }
    storageRepository.set("config",config);return Promise.resolve(true);
  },
};
