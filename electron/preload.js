import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("weekToDoDesktop", {
  googleTasks: {
    status: () => ipcRenderer.invoke("google-tasks:status"),
    signIn: () => ipcRenderer.invoke("google-tasks:signIn"),
    disconnect: () => ipcRenderer.invoke("google-tasks:disconnect"),
    lists: () => ipcRenderer.invoke("google-tasks:lists"),
    tasks: (id) => ipcRenderer.invoke("google-tasks:tasks", id),
    write: (request) => ipcRenderer.invoke("google-tasks:write", request),
  },
  showCurrentWindow: () => ipcRenderer.send("show-current-window"),
  isWindowVisible: () => ipcRenderer.sendSync("is-window-visible"),
  matchOpenOnStartup: (enabled) => ipcRenderer.send("match-open-on-startup", Boolean(enabled)),
  setOpenOnStartup: (enabled) => ipcRenderer.send("set-open-on-startup", Boolean(enabled)),
  setRunInBackground: (enabled) => ipcRenderer.send("set-run-in-background", Boolean(enabled)),
  setTrayLabels: (labels) =>
    ipcRenderer.send("set-tray-labels", {
      open: String(labels.open),
      quit: String(labels.quit),
    }),
  setDarkTrayIcon: (enabled) => ipcRenderer.send("set-dark-tray-icon", Boolean(enabled)),
  clearDesktopConfig: () => ipcRenderer.send("clear-desktop-config"),
  openExternal: (url) => ipcRenderer.invoke("open-external", String(url)),
  localSync: { discover: () => ipcRenderer.invoke("local-sync-discover") },
  syncCredentials: {
    set: (name, value) => ipcRenderer.invoke("sync-credential-set", String(name), String(value)),
    get: (name) => ipcRenderer.invoke("sync-credential-get", String(name)),
    remove: (name) => ipcRenderer.invoke("sync-credential-remove", String(name)),
  },
  onInitialChecks: (callback) => {
    const listener = () => callback();
    ipcRenderer.on("initial-checks", listener);
    return () => ipcRenderer.removeListener("initial-checks", listener);
  },
});
