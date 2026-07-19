const { app, BrowserWindow, ipcMain, safeStorage, shell } = require("electron");
const path = require("node:path");
const { ProfileStore } = require("./profile-store.cjs");
const { captureCredentialBundle, getClaudeStatus, hasRunningClaude, launchClaudeLogin, writeCredentials } = require("./claude-service.cjs");

let mainWindow;
let store;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280, height: 820, minWidth: 900, minHeight: 620,
    title: "Claude Switcher", backgroundColor: "#f8f7f4",
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) mainWindow.loadURL(devUrl);
  else mainWindow.loadFile(path.join(__dirname, "..", "dist", "index.html"));
  mainWindow.webContents.setWindowOpenHandler(({ url }) => { if (/^https:\/\//.test(url)) shell.openExternal(url); return { action: "deny" }; });
}

async function state() {
  const [metadata, claude] = await Promise.all([store.metadata(), getClaudeStatus()]);
  return {
    accounts: metadata.accounts,
    activity: metadata.activity,
    claude,
    security: { encryptionAvailable: store.encryptionAvailable(), platform: process.platform },
  };
}

function registerIpc() {
  ipcMain.handle("state:get", state);
  ipcMain.handle("account:capture", async (_event, alias) => {
    const bundle = await captureCredentialBundle();
    await store.add(String(alias), bundle);
    return state();
  });
  ipcMain.handle("account:activate", async (_event, id) => {
    if (await hasRunningClaude()) throw new Error("Close all running Claude Code sessions before switching accounts, then try again.");
    const bundle = await store.secret(String(id));
    await writeCredentials(bundle, store.backupDir());
    await store.markActive(String(id));
    return state();
  });
  ipcMain.handle("account:rename", async (_event, id, alias) => { await store.rename(String(id), String(alias)); return state(); });
  ipcMain.handle("account:remove", async (_event, id) => { await store.remove(String(id)); return state(); });
  ipcMain.handle("auth:login", async () => {
    await launchClaudeLogin();
    return { ok: true, message: "Claude login opened in a terminal. Finish authentication, then return and capture the account." };
  });
}

app.whenReady().then(() => {
  store = new ProfileStore(app.getPath("userData"), safeStorage);
  registerIpc();
  createWindow();
  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
