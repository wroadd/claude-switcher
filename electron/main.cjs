const { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, safeStorage, Tray } = require("electron");
const path = require("node:path");
const { ProfileStore } = require("./profile-store.cjs");
const claude = require("./claude-service.cjs");
const { ActivationCoordinator } = require("./activation-coordinator.cjs");
const { CHANNELS, parseRequest } = require("./ipc-contracts.cjs");
const { assessSecureStorage } = require("./secure-storage-policy.cjs");
const { configureWindowSecurity, rendererTarget } = require("./window-policy.cjs");
const { registerAuthorizedHandler } = require("./ipc-boundary.cjs");
const { createDiagnostics, DIAGNOSTIC_EVENT_CODES } = require("./diagnostics.cjs");
const { createTrayController } = require("./tray-controller.cjs");
const { applyDockMode, shouldHideWindowOnClose } = require("./desktop-lifecycle.cjs");
const { assertMutationsAllowed, runRecoveryTrackedOperation } = require("./recovery-state.cjs");

let mainWindow;
let store;
let coordinator;
let recovery = { status: "clear" };
let storagePolicy;
let trayController;
let isQuitting = false;
let desktopPreferences = { closeBehavior: "hide", dockMode: "dock-and-menu-bar" };

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
    "INVALID_RETENTION", "INVALID_CLOSE_BEHAVIOR", "INVALID_DOCK_MODE",
  ]);
  if (allowed.has(error?.code)) return error;
  const sanitized = new Error("The operation could not be completed safely. Check the application status and try again.");
  sanitized.code = "INTERNAL_ERROR";
  return sanitized;
}

function ensureMutationsAllowed() {
  assertMutationsAllowed({ health: store.health(), recovery });
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
  mainWindow.on("close", (event) => {
    if (shouldHideWindowOnClose({ isQuitting, closeBehavior: desktopPreferences.closeBehavior, trayAvailable: trayController?.available() === true })) {
      event.preventDefault();
      mainWindow.hide();
    }
  });

  return rendererTarget({ isPackaged: app.isPackaged, devUrl: process.env.VITE_DEV_SERVER_URL });
}

async function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    const target = createWindow();
    await loadWindow(target);
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
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

async function runCredentialOperation(operation) {
  ensureCredentialOperationsAllowed();
  return runRecoveryTrackedOperation(operation, (nextRecovery) => { recovery = nextRecovery; });
}

async function activateProfile(id) { return runCredentialOperation(() => coordinator.activate(id)); }
async function restoreRecovery(recoveryId) { return runCredentialOperation(() => coordinator.restore(recoveryId)); }

async function refreshDesktop() {
  const metadata = await store.metadata();
  desktopPreferences = metadata.preferences;
  await applyDockMode({ platform: process.platform, dock: app.dock, dockMode: desktopPreferences.dockMode, trayAvailable: trayController?.available() === true });
  await trayController?.refresh();
  return state();
}

function registerIpc() {
  handle(CHANNELS.state, state);
  handle(CHANNELS.capture, async ({ alias }) => {
    ensureCredentialOperationsAllowed();
    const bundle = await claude.captureCredentialBundle();
    await store.add(alias, bundle);
    return refreshDesktop();
  });
  handle(CHANNELS.activate, async ({ id }) => {
    await activateProfile(id);
    return refreshDesktop();
  });
  handle(CHANNELS.rename, async ({ id, alias }) => { ensureMutationsAllowed(); await store.rename(id, alias); return refreshDesktop(); });
  handle(CHANNELS.remove, async ({ id }) => { ensureMutationsAllowed(); await store.remove(id); return refreshDesktop(); });
  handle(CHANNELS.restore, async ({ id }) => { await restoreRecovery(id); return refreshDesktop(); });
  handle(CHANNELS.retryRecovery, async () => {
    if (!storagePolicy.usable) {
      const error = new Error(storagePolicy.remediation || "A supported operating-system credential service is required for recovery.");
      error.code = storagePolicy.reason || "ENCRYPTION_UNAVAILABLE";
      throw error;
    }
    recovery = await coordinator.recoverPending();
    return refreshDesktop();
  });
  handle(CHANNELS.retention, async ({ value }) => { ensureMutationsAllowed(); await store.setRecoveryRetention(value); return refreshDesktop(); });
  handle(CHANNELS.closeBehavior, async ({ value }) => { ensureMutationsAllowed(); await store.setCloseBehavior(value); return refreshDesktop(); });
  handle(CHANNELS.dockMode, async ({ value }) => { ensureMutationsAllowed(); await store.setDockMode(value); return refreshDesktop(); });
  handle(CHANNELS.trayDisplayMode, async ({ value }) => { ensureMutationsAllowed(); await store.setTrayDisplayMode(value); return refreshDesktop(); });
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
  app.on("second-instance", () => { void showMainWindow(); });
  app.on("activate", () => { void showMainWindow(); });
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
  desktopPreferences = (await store.metadata()).preferences;
  trayController = createTrayController({
    Tray, Menu, nativeImage, platform: process.platform,
    iconPath: path.join(__dirname, "..", "build", process.platform === "darwin" ? "trayTemplate.png" : "icon.png"),
    getState: state,
    activate: activateProfile,
    showWindow: () => { void showMainWindow(); },
    quit: () => { isQuitting = true; app.quit(); },
    setDockMode: async (mode) => { ensureMutationsAllowed(); await store.setDockMode(mode); desktopPreferences = (await store.metadata()).preferences; await applyDockMode({ platform: process.platform, dock: app.dock, dockMode: mode, trayAvailable: true }); },
    onError: async (error) => {
      const safe = publicError(error);
      const options = { type: "error", title: "Claude Switcher", message: safe.message };
      if (mainWindow && !mainWindow.isDestroyed()) await dialog.showMessageBox(mainWindow, options);
      else await dialog.showMessageBox(options);
    },
  });
  try {
    await trayController.start();
    await applyDockMode({ platform: process.platform, dock: app.dock, dockMode: desktopPreferences.dockMode, trayAvailable: true });
  } catch (error) {
    trayController?.dispose();
    console.error("Claude Switcher tray is unavailable:", error?.code || "TRAY_UNAVAILABLE");
  }
  if (process.env.CLAUDE_SWITCHER_SMOKE === "1") {
    const preferences = mainWindow.webContents.getLastWebPreferences();
    if (!preferences.contextIsolation || preferences.nodeIntegration || !preferences.sandbox) throw new Error("Electron security preferences failed smoke validation.");
    console.log("CLAUDE_SWITCHER_SMOKE_OK");
    app.quit();
  }
}).catch((error) => {
  console.error("Claude Switcher failed to initialize safely:", error?.code || "INITIALIZATION_FAILED");
  app.quit();
});

app.on("before-quit", () => { isQuitting = true; });
app.on("window-all-closed", () => app.quit());
