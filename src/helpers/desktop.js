function api() {
  return window.weekToDoDesktop;
}

export function isDesktop() {
  return Boolean(api());
}

export default {
  isDesktop,
  showCurrentWindow: () => api()?.showCurrentWindow(),
  isWindowVisible: () => api()?.isWindowVisible() ?? true,
  matchOpenOnStartup: (enabled) => api()?.matchOpenOnStartup(enabled),
  setOpenOnStartup: (enabled) => api()?.setOpenOnStartup(enabled),
  setRunInBackground: (enabled) => api()?.setRunInBackground(enabled),
  setTrayLabels: (labels) => api()?.setTrayLabels(labels),
  setDarkTrayIcon: (enabled) => api()?.setDarkTrayIcon(enabled),
  clearDesktopConfig: () => api()?.clearDesktopConfig(),
  openExternal: (url) => (api() ? api().openExternal(url) : window.open(url, "_blank")),
  onInitialChecks: (callback) => api()?.onInitialChecks(callback),
  discoverLocalSyncHosts: () => api()?.localSync?.discover?.() || Promise.resolve([]),
  syncCredentials: {
    set: (name, value) => api()?.syncCredentials.set(name, value),
    get: (name) => api()?.syncCredentials.get(name),
    remove: (name) => api()?.syncCredentials.remove(name),
  },
};
