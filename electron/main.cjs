const { app, BrowserWindow, dialog, ipcMain, safeStorage } = require("electron");
const path = require("node:path");
const { ProfileStore } = require("./profile-store.cjs");
const claude = require("./claude-service.cjs");
const { ActivationCoordinator } = require("./activation-coordinator.cjs");
const { CHANNELS, parseRequest } = require("./ipc-contracts.cjs");
const { assessSecureStorage } = require("./secure-storage-policy.cjs");
const { configureWindowSecurity, rendererTarget } = require("./window-policy.cjs");
const { registerAuthorizedHandler } = require("./ipc-boundary.cjs");
const { createDiagnostics, DIAGNOSTIC_EVENT_CODES } = require("./diagnostics.cjs");

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
    "DIAGNOSTICS_INVALID_INPUT", "DIAGNOSTICS_UNSAFE_CONTENT", "DIAGNOSTICS_SIZE_LIMIT", "DIAGNOSTICS_WRITE_FAILED",
    "RECOVERY_PROFILE_MISSING", "RESTORE_FAILED", "ENCRYPTION_UNAVAILABLE",
    "INVALID_RETENTION",
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

function ensureCredentialOperationsAllowed() {
  ensureMutationsAllowed();
  if (!storagePolicy.usable) {
    const error = new Error(storagePolicy.remediation || "A supported operating-system credential service is required.");
    error.code = storagePolicy.reason || "ENCRYPTION_UNAVAILABLE";
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

  configureWindowSecurity(mainWindow.webContents, { packaged: app.isPackaged });

  return rendererTarget({ isPackaged: app.isPackaged, devUrl: process.env.VITE_DEV_SERVER_URL });
}

async function loadWindow(target) {
  if (target.kind === "url") await mainWindow.loadURL(target.url);
  else await mainWindow.loadFile(path.join(__dirname, "..", "dist", "index.html"));
}

async function state() {
  const [metadata, claudeStatus, recoveries] = await Promise.all([store.metadata(), claude.getClaudeStatus(), store.listRecoveryRecords()]);
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
    recoveries,
    preferences: metadata.preferences,
  };
}

function handle(channel, operation) {
  registerAuthorizedHandler({ ipcMain, channel, getWindow: () => mainWindow, operation, mapError: publicError });
}

function registerIpc() {
  handle(CHANNELS.state, state);
  handle(CHANNELS.capture, async ({ alias }) => {
    ensureCredentialOperationsAllowed();
    const bundle = await claude.captureCredentialBundle();
    await store.add(alias, bundle);
    return state();
  });
  handle(CHANNELS.activate, async ({ id }) => {
    ensureCredentialOperationsAllowed();
    await coordinator.activate(id);
    return state();
  });
  handle(CHANNELS.rename, async ({ id, alias }) => { ensureMutationsAllowed(); await store.rename(id, alias); return state(); });
  handle(CHANNELS.remove, async ({ id }) => { ensureMutationsAllowed(); await store.remove(id); return state(); });
  handle(CHANNELS.restore, async ({ id }) => { ensureCredentialOperationsAllowed(); await coordinator.restore(id); return state(); });
  handle(CHANNELS.retryRecovery, async () => {
    if (!storagePolicy.usable) {
      const error = new Error(storagePolicy.remediation || "A supported operating-system credential service is required for recovery.");
      error.code = storagePolicy.reason || "ENCRYPTION_UNAVAILABLE";
      throw error;
    }
    recovery = await coordinator.recoverPending();
    return state();
  });
  handle(CHANNELS.retention, async ({ value }) => { ensureMutationsAllowed(); await store.setRecoveryRetention(value); return state(); });
  handle(CHANNELS.diagnostics, async () => {
    const result = await dialog.showSaveDialog(mainWindow, {
      title: "Export redacted diagnostics",
      defaultPath: `claude-switcher-support-${new Date().toISOString().slice(0, 10)}.json`,
      filters: [{ name: "JSON", extensions: ["json"] }],
      properties: ["createDirectory", "showOverwriteConfirmation"],
    });
    if (result.canceled || !result.filePath) return { ok: false, message: "Diagnostics export canceled." };
    const metadata = await store.metadata();
    const eventCodes = {
      captured: DIAGNOSTIC_EVENT_CODES.PROFILE_CAPTURED,
      activated: DIAGNOSTIC_EVENT_CODES.PROFILE_ACTIVATED,
      renamed: DIAGNOSTIC_EVENT_CODES.PROFILE_RENAMED,
      removed: DIAGNOSTIC_EVENT_CODES.PROFILE_REMOVED,
      "activation-rolled-back": DIAGNOSTIC_EVENT_CODES.ROLLBACK_COMPLETED,
      "activation-recovery-required": DIAGNOSTIC_EVENT_CODES.ROLLBACK_FAILED,
    };
    const diagnostics = createDiagnostics();
    const exported = await diagnostics.exportBundle(result.filePath, {
      app: { version: app.getVersion(), packaged: app.isPackaged },
      runtime: { platform: process.platform, architecture: process.arch, nodeVersion: process.versions.node, electronVersion: process.versions.electron, locale: app.getLocale() },
      storageHealth: store.health(),
      capabilities: { secureStorage: storagePolicy.usable, processDetection: true, recoveryRecords: true },
      profiles: metadata.accounts,
      events: metadata.activity.map((event) => ({ code: eventCodes[event.type] || DIAGNOSTIC_EVENT_CODES.OTHER, errorCode: event.details?.code || null, profileId: event.accountId, alias: event.alias, at: event.at })),
    });
    return { ok: true, message: `Redacted diagnostics exported (${exported.bytes} bytes).` };
  });
  handle(CHANNELS.login, async () => {
    ensureMutationsAllowed();
    await claude.launchClaudeLogin();
    return { ok: true, message: "Claude login opened in a terminal. Finish authentication, then return and capture the account." };
  });
}

if (hasLock) {
  app.on("second-instance", () => { if (mainWindow) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.show(); mainWindow.focus(); } });
  app.on("activate", async () => { if (BrowserWindow.getAllWindows().length === 0) { const target = createWindow(); await loadWindow(target); } });
}

if (hasLock) app.whenReady().then(async () => {
  const backend = process.platform === "linux" ? safeStorage.getSelectedStorageBackend() : null;
  storagePolicy = assessSecureStorage({ platform: process.platform, encryptionAvailable: safeStorage.isEncryptionAvailable(), backend });
  store = new ProfileStore(app.getPath("userData"), safeStorage, storagePolicy);
  await store.readState();
  coordinator = new ActivationCoordinator({ store, adapter: claude });
  if (storagePolicy.usable) recovery = await coordinator.recoverPending();
  else {
    const pending = await store.readJournal();
    recovery = pending ? { status: "recovery-required", recoveryId: pending.recoveryId, reason: storagePolicy.reason } : { status: "clear" };
  }
  const target = createWindow();
  registerIpc();
  await loadWindow(target);
}).catch((error) => {
  console.error("Claude Switcher failed to initialize safely:", error?.code || "INITIALIZATION_FAILED");
  app.quit();
});

app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
