import { prepareEntity } from "./syncModel";

export const DEVICE_SETTING_KEYS = new Set([
  "version",
  "firstTimeOpen",
  "checkUpdates",
  "openOnStartup",
  "runInBackground",
  "darkTrayIcon",
  "importing",
  "notificationOnStartup",
  "notificationSound",
  "reportErrors",
]);

export function sharedSettings(config) {
  return Object.fromEntries(Object.entries(config).filter(([key]) => !DEVICE_SETTING_KEYS.has(key)));
}

export function prepareSharedSettings(config, previousConfig, metadata, options) {
  const current = { ...sharedSettings(config), _sync: metadata };
  const previous = previousConfig ? { ...sharedSettings(previousConfig), _sync: metadata } : null;
  return prepareEntity(current, previous, options);
}
