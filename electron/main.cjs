const { app, BrowserWindow, ipcMain, safeStorage } = require("electron");
const path = require("node:path");
const { ProfileStore } = require("./profile-store.cjs");
const claude = require("./claude-service.cjs");
const { ActivationCoordinator } = require("./activation-coordinator.cjs");
const { CHANNELS, parseRequest } = require("./ipc-contracts.cjs");
const { assessSecureStorage } = require("./secure-storage-policy.cjs");
const { authorizeSender, rendererTarget } = require("./window-policy.cjs");

let mainWindow;
let store;
let coordinator;
let recovery = { status: "clear" };
let storagePolicy;

const hasLock = app.requestSingleInstanceLock();
if (!hasLock) app.quit();

function publicError(error) {
  const allowed = new Set([
    "INVALID_REQUEST", "INVALID_ALIAS", "INVALID_PROFILE_ID", "UNAUTHORIZED_IPC",
    "CLAUDE_RUNNING", "PROCESS_STATUS_UNKNOWN", "IDENTITY_VERIFICATION_FAILED",
    "ACTIVATION_FAILED", "ROLLBACK_FAILED", "STORE_CORRUPT",
    "STORE_FUTURE_VERSION", "RECOVERY_REQUIRED", "INSECURE_LINUX_BACKEND",
    "CONCURRENT_AUTH_CHANGE",
  ]);
  if (allowed.has(error?.code)) return error;
  const sanitized = new Error("The operation could not be completed safely. Check the application status and try again.");
  sanitized.code = "INTERNAL_ERROR";
  return sanitized;
}

function ensureMutationsAllowed() {
  const health = store.health();
  if (health.mode !== "ready") {
    const error = new Error(health.mode === "read-only" ? "This profile store was created by a newer Claude Switcher version and is read-only." : `Profile store recovery is required. Quarantine: ${health.quarantine || "unknown"}`);
    error.code = health.reason;
    throw error;
  }
  if (recovery.status === "recovery-required") {
    const error = new Error(`An interrupted activation requires recovery before changes can continue. Recovery ID: ${recovery.recoveryId}`);
    error.code = "RECOVERY_REQUIRED";
    throw error;
  }
}

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
      webviewTag: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      navigateOnDragDrop: false,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  mainWindow.webContents.on("will-navigate", (event) => event.preventDefault());
  mainWindow.webContents.on("will-frame-navigate", (event) => event.preventDefault());
  mainWindow.webContents.on("will-attach-webview", (event) => event.preventDefault());
  const rendererSession = mainWindow.webContents.session;
  rendererSession.setPermissionCheckHandler(() => false);
  rendererSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));

  const target = rendererTarget({ isPackaged: app.isPackaged, devUrl: process.env.VITE_DEV_SERVER_URL });
  if (target.kind === "url") mainWindow.loadURL(target.url);
  else mainWindow.loadFile(path.join(__dirname, "..", "dist", "index.html"));
}

async function state() {
  const [metadata, claudeStatus] = await Promise.all([store.metadata(), claude.getClaudeStatus()]);
  return {
    accounts: metadata.accounts,
    activity: metadata.activity,
    claude: claudeStatus,
    security: {
      encryptionAvailable: storagePolicy.usable,
      platform: process.platform,
      storageBackend: storagePolicy.backend,
      reason: storagePolicy.reason,
      remediation: storagePolicy.remediation,
    },
    recovery,
    store: { ...store.health(), revision: metadata.revision },
  };
}

function handle(channel, operation) {
  ipcMain.handle(channel, async (event, request) => {
    try {
      authorizeSender(event, mainWindow);
      const parsed = parseRequest(channel, request);
      return await operation(parsed);
    } catch (error) { throw publicError(error); }
  });
}

function registerIpc() {
  handle(CHANNELS.state, state);
  handle(CHANNELS.capture, async ({ alias }) => {
    ensureMutationsAllowed();
    const bundle = await claude.captureCredentialBundle();
    await store.add(alias, bundle);
    return state();
  });
  handle(CHANNELS.activate, async ({ id }) => {
    ensureMutationsAllowed();
    await coordinator.activate(id);
    return state();
  });
  handle(CHANNELS.rename, async ({ id, alias }) => { ensureMutationsAllowed(); await store.rename(id, alias); return state(); });
  handle(CHANNELS.remove, async ({ id }) => { ensureMutationsAllowed(); await store.remove(id); return state(); });
  handle(CHANNELS.login, async () => {
    await claude.launchClaudeLogin();
    return { ok: true, message: "Claude login opened in a terminal. Finish authentication, then return and capture the account." };
  });
}

if (hasLock) app.whenReady().then(async () => {
  const backend = process.platform === "linux" ? safeStorage.getSelectedStorageBackend() : null;
  storagePolicy = assessSecureStorage({ platform: process.platform, encryptionAvailable: safeStorage.isEncryptionAvailable(), backend });
  store = new ProfileStore(app.getPath("userData"), safeStorage, storagePolicy);
  await store.readState();
  coordinator = new ActivationCoordinator({ store, adapter: claude });
  recovery = await coordinator.recoverPending();
  createWindow();
  registerIpc();
  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
  app.on("second-instance", () => { if (mainWindow) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.show(); mainWindow.focus(); } });
}).catch((error) => {
  console.error("Claude Switcher failed to initialize safely:", error?.code || "INITIALIZATION_FAILED");
  app.quit();
});

app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
