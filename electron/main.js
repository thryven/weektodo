import { app, BrowserWindow, Menu, Tray, ipcMain, nativeImage, safeStorage, shell } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import AutoLaunch from "auto-launch";
import Config from "electron-config";
import dgram from "node:dgram";

const config = new Config();
const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const isDevelopment = Boolean(process.env.VITE_DEV_SERVER_URL);

let mainWindow = null;
let tray = null;
let trayMenuTemplate = null;
let splashScreenIsHidden = true;
let isQuitting = false;

function appAssetPath(filename) {
  if (isDevelopment) return path.join(process.cwd(), "public", filename);
  return path.join(app.getAppPath(), "dist", filename);
}

function createAutoLauncher() {
  return new AutoLaunch({
    name: "WeekToDo Planner",
    path: app.getPath("exe"),
  });
}

function isAllowedExternalUrl(rawUrl) {
  try {
    return ["https:", "http:", "mailto:"].includes(new URL(rawUrl).protocol);
  } catch {
    return false;
  }
}

function discoverLocalSyncHosts(timeoutMs=1500) {
  return new Promise((resolve)=>{const socket=dgram.createSocket("udp4");const found=new Map();let finished=false;
    const finish=()=>{if(finished)return;finished=true;socket.close(()=>resolve([...found.values()]));};
    socket.on("message",(message)=>{try{const host=JSON.parse(message.toString());if(host.service==="weektodo-sync"&&host.protocolVersion===1&&host.address)
      found.set(host.address,{name:String(host.name||"WeekToDo"),address:String(host.address),protocolVersion:1});}catch{/* Ignore unrelated LAN packets. */}});
    socket.on("error",finish);socket.bind(0,"0.0.0.0",()=>{socket.setBroadcast(true);
      socket.send(Buffer.from("WEEKTODO_DISCOVER_V1"),48161,"255.255.255.255",(error)=>{if(error)finish();});});
    setTimeout(finish,timeoutMs);
  });
}

async function createWindow() {
  const options = {
    minWidth: 1000,
    minHeight: 600,
    show: !config.get("runInBackground"),
    icon: appAssetPath("icon.png"),
    webPreferences: {
      preload: path.join(currentDirectory, "preload.js"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  };

  Object.assign(options, config.get("winBounds"));
  mainWindow = new BrowserWindow(options);
  mainWindow.removeMenu();

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedExternalUrl(url)) shell.openExternal(url);
    return { action: "deny" };
  });

  mainWindow.on("close", (event) => {
    if (isQuitting) return;

    event.preventDefault();
    saveWindowState();
    if (config.get("runInBackground")) hideWindow(mainWindow);
    else closeApp();
  });

  mainWindow.on("restore", () => setTimeout(hideSplashScreen, 4500));

  if (isDevelopment) {
    await mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    await mainWindow.loadFile(path.join(app.getAppPath(), "dist", "index.html"));
  }
}

function registerIpcHandlers() {
  ipcMain.on("show-current-window", (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (config.get("isMaximized")) window.maximize();
    showWindow(window);
  });

  ipcMain.on("is-window-visible", (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    event.returnValue = Boolean(window?.isVisible());
  });

  ipcMain.on("set-open-on-startup", (_event, enabled) => setOpenOnStartup(enabled));
  ipcMain.on("match-open-on-startup", (_event, enabled) => matchOpenOnStartup(enabled));
  ipcMain.on("set-run-in-background", (_event, enabled) => config.set("runInBackground", enabled));
  ipcMain.on("set-dark-tray-icon", (_event, enabled) => {
    config.set("darkTrayIcon", enabled);
    tray?.setImage(createTrayIcon());
  });
  ipcMain.on("set-tray-labels", (_event, labels) => setTrayLabels(labels));
  ipcMain.on("clear-desktop-config", () => config.set("runInBackground", true));
  ipcMain.handle("open-external", async (_event, url) => {
    if (!isAllowedExternalUrl(url)) throw new Error("External URL protocol is not allowed");
    await shell.openExternal(url);
  });
  ipcMain.handle("local-sync-discover",()=>discoverLocalSyncHosts());
  const credentialNames = new Set(["syncRefreshToken", "syncAccountKey"]);
  ipcMain.handle("sync-credential-set", (_event, name, value) => {
    if (!credentialNames.has(name) || !safeStorage.isEncryptionAvailable()) throw new Error("Secure credential storage unavailable");
    config.set(`secure.${name}`, safeStorage.encryptString(String(value)).toString("base64"));
  });
  ipcMain.handle("sync-credential-get", (_event, name) => {
    if (!credentialNames.has(name) || !safeStorage.isEncryptionAvailable()) return null;
    const encrypted = config.get(`secure.${name}`);
    return encrypted ? safeStorage.decryptString(Buffer.from(encrypted, "base64")) : null;
  });
  ipcMain.handle("sync-credential-remove", (_event, name) => {
    if (!credentialNames.has(name)) throw new Error("Unsupported credential");
    config.delete(`secure.${name}`);
  });
}

function saveWindowState() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  config.set("winBounds", mainWindow.getBounds());
  config.set("isMaximized", mainWindow.isMaximized());
}

function hideSplashScreen() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.executeJavaScript(
    "document.getElementById('splashScreen')?.classList.add('hiddenSplashScreen')"
  );
}

function setOpenOnStartup(enabled) {
  const launcher = createAutoLauncher();
  return enabled ? launcher.enable() : launcher.disable();
}

function matchOpenOnStartup(enabled) {
  const launcher = createAutoLauncher();
  launcher
    .isEnabled()
    .then((isEnabled) => {
      if (enabled !== isEnabled) return setOpenOnStartup(enabled);
    })
    .catch((error) => console.error("Unable to match launch-on-startup setting", error));
}

function setTrayLabels(labels) {
  config.set("openLabel", labels.open);
  config.set("quitLabel", labels.quit);
  trayMenuTemplate[0].label = labels.open;
  trayMenuTemplate[1].label = labels.quit;
  tray?.setContextMenu(Menu.buildFromTemplate(trayMenuTemplate));
}

function showWindow(window) {
  if (process.platform === "darwin") app.dock.show();
  window.show();
  if (splashScreenIsHidden) {
    splashScreenIsHidden = false;
    setTimeout(() => mainWindow?.webContents.send("initial-checks"), 4000);
  }
}

function hideWindow(window) {
  window.hide();
  if (process.platform === "darwin") app.dock.hide();
}

function closeApp() {
  isQuitting = true;
  saveWindowState();
  app.quit();
}

function createTray() {
  if (typeof config.get("darkTrayIcon") === "undefined") config.set("darkTrayIcon", false);
  if (!config.get("openLabel")) {
    config.set("openLabel", "Open");
    config.set("quitLabel", "Quit");
  }

  tray = new Tray(createTrayIcon());
  trayMenuTemplate = [
    {
      label: config.get("openLabel"),
      click() {
        if (config.get("isMaximized")) mainWindow?.maximize();
        if (mainWindow) showWindow(mainWindow);
        setTimeout(hideSplashScreen, 5000);
      },
    },
    {
      label: config.get("quitLabel"),
      click: closeApp,
    },
  ];

  tray.setToolTip("WeekToDo Planner");
  tray.setContextMenu(Menu.buildFromTemplate(trayMenuTemplate));
  tray.on("click", () => tray?.popUpContextMenu());
}

function createTrayIcon() {
  const darkPrefix = config.get("darkTrayIcon") ? "Dark" : "";
  let filename;

  if (process.platform === "win32") {
    app.setAppUserModelId("WeekToDo");
    filename = `trayIcon${darkPrefix}.ico`;
  } else if (process.platform === "darwin") {
    return nativeImage.createFromPath(appAssetPath(`trayIcon${darkPrefix}.png`));
  } else {
    filename = `trayIcon${darkPrefix}@3x.png`;
  }

  return appAssetPath(filename);
}

const hasSingleInstanceLock = app.requestSingleInstanceLock();

if (!hasSingleInstanceLock) {
  app.quit();
} else {
  registerIpcHandlers();

  app.on("second-instance", () => {
    if (!mainWindow) createWindow();
    else {
      if (mainWindow.isMinimized()) mainWindow.restore();
      if (config.get("isMaximized")) mainWindow.maximize();
      showWindow(mainWindow);
    }
    setTimeout(hideSplashScreen, 5000);
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
    else if (process.platform === "darwin" && !app.dock.isVisible()) showWindow(mainWindow);
  });

  app.whenReady().then(async () => {
    if (typeof config.get("runInBackground") === "undefined") config.set("runInBackground", true);
    createTray();
    await createWindow();

  });
}
