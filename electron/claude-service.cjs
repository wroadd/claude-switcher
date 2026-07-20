const { execFile, spawn } = require("node:child_process");
const { promisify } = require("node:util");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { probeClaudeProcesses } = require("./process-probe.cjs");

const execFileAsync = promisify(execFile);
const KEYCHAIN_SERVICE = "Claude Code-credentials";
const MAX_CREDENTIAL_BYTES = 2 * 1024 * 1024;
const MAX_CONFIG_BYTES = 8 * 1024 * 1024;

function claudeConfigDir() {
  return process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude");
}

function rootConfigPath() {
  return process.env.CLAUDE_CONFIG_DIR
    ? path.join(process.env.CLAUDE_CONFIG_DIR, ".claude.json")
    : path.join(os.homedir(), ".claude.json");
}

function credentialsPath() {
  return path.join(claudeConfigDir(), ".credentials.json");
}

function safeProfileId(alias) {
  const normalized = alias.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 32);
  return `${normalized || "account"}-${Date.now().toString(36)}`;
}

function normalizeStatus(raw) {
  return {
    installed: true,
    loggedIn: Boolean(raw?.loggedIn),
    email: typeof raw?.email === "string" ? raw.email : null,
    authMethod: typeof raw?.authMethod === "string" ? raw.authMethod : "unknown",
    subscriptionType: typeof raw?.subscriptionType === "string" ? raw.subscriptionType : null,
    orgId: typeof raw?.orgId === "string" ? raw.orgId : null,
  };
}

async function commandExists(command) {
  const locator = process.platform === "win32" ? "where" : "which";
  try { await execFileAsync(locator, [command], { timeout: 5000 }); return true; } catch { return false; }
}

async function getClaudeStatus() {
  if (!(await commandExists("claude"))) return { installed: false, loggedIn: false, email: null, version: null };
  let version = null;
  try { version = (await execFileAsync("claude", ["--version"], { timeout: 5000 })).stdout.trim(); } catch {}
  try {
    const { stdout } = await execFileAsync("claude", ["auth", "status", "--json"], { timeout: 8000, maxBuffer: 1024 * 1024 });
    return { ...normalizeStatus(JSON.parse(stdout)), version };
  } catch {
    return { installed: true, loggedIn: false, email: null, version };
  }
}

async function readJson(file, fallback = null, maxBytes = MAX_CONFIG_BYTES) {
  try {
    const stat = await fs.stat(file);
    if (stat.size > maxBytes) throw new Error("Claude configuration exceeds the safe size limit.");
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return fallback;
    throw error;
  }
}

async function readFileSnapshot(file, maxBytes = MAX_CONFIG_BYTES) {
  try {
    const stat = await fs.lstat(file);
    if (stat.isSymbolicLink()) throw new Error("Claude configuration symlinks are not supported for privileged writes.");
    if (!stat.isFile() || stat.size > maxBytes) throw new Error("Claude configuration has an unsafe file type or size.");
    return { present: true, value: await fs.readFile(file, "utf8"), mode: stat.mode & 0o777 };
  } catch (error) {
    if (error.code === "ENOENT") return { present: false, value: null, mode: null };
    throw error;
  }
}

function parseCredentialValue(value) {
  if (typeof value !== "string" || Buffer.byteLength(value) > MAX_CREDENTIAL_BYTES) throw new Error("Claude credentials exceed the safe size limit.");
  const parsed = JSON.parse(value);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Claude credentials are not a JSON object.");
  return parsed;
}

async function readCurrentCredentials() {
  if (process.platform === "darwin") {
    try {
      const account = await readKeychainAccount();
      const { stdout } = await execFileAsync("security", ["find-generic-password", "-s", KEYCHAIN_SERVICE, "-w"], { timeout: 8000, maxBuffer: MAX_CREDENTIAL_BYTES });
      const value = stdout.trim();
      parseCredentialValue(value);
      return { source: "macos-keychain", present: true, account, value, mode: null };
    } catch (keychainError) {
      const notFound = Number(keychainError.code) === 44 || /could not be found/i.test(String(keychainError.stderr || ""));
      if (!notFound) {
        const error = new Error("Claude credentials could not be read from macOS Keychain.");
        error.code = "KEYCHAIN_ACCESS_FAILED";
        throw error;
      }
      const snapshot = await readFileSnapshot(credentialsPath(), MAX_CREDENTIAL_BYTES);
      if (snapshot.present) {
        parseCredentialValue(snapshot.value);
        return { source: "credentials-file", present: true, account: null, value: snapshot.value, mode: snapshot.mode };
      }
      const error = new Error("Claude credentials were not found in macOS Keychain or ~/.claude/.credentials.json.");
      error.code = "CREDENTIALS_NOT_FOUND";
      throw error;
    }
  }
  const snapshot = await readFileSnapshot(credentialsPath(), MAX_CREDENTIAL_BYTES);
  if (!snapshot.present) {
    const error = new Error("Claude credentials were not found at ~/.claude/.credentials.json.");
    error.code = "CREDENTIALS_NOT_FOUND";
    throw error;
  }
  parseCredentialValue(snapshot.value);
  return { source: "credentials-file", present: true, account: null, value: snapshot.value, mode: snapshot.mode };
}

async function readKeychainAccount() {
  const result = await execFileAsync("security", ["find-generic-password", "-s", KEYCHAIN_SERVICE], { timeout: 8000, maxBuffer: 256 * 1024 });
  const output = `${result.stdout || ""}\n${result.stderr || ""}`;
  const match = output.match(/"acct"<blob>="([^"]+)"/);
  if (!match) {
    const error = new Error("Claude Keychain item account identity could not be determined.");
    error.code = "KEYCHAIN_ACCOUNT_UNKNOWN";
    throw error;
  }
  return match[1];
}

async function captureCredentialState({ requireLogin = false } = {}) {
  const status = await getClaudeStatus();
  if (requireLogin && !status.installed) throw new Error("Claude Code is not installed or is not available on PATH.");
  if (requireLogin && !status.loggedIn) throw new Error("Claude Code is not logged in. Open Claude login, finish authentication, and try again.");
  let credentials;
  try { credentials = await readCurrentCredentials(); }
  catch (error) {
    if (requireLogin || error.code !== "CREDENTIALS_NOT_FOUND") throw error;
    credentials = { source: process.platform === "darwin" ? "macos-keychain" : "credentials-file", present: false, account: process.platform === "darwin" ? os.userInfo().username : null, value: null, mode: null };
  }
  const rootConfigSnapshot = await readFileSnapshot(rootConfigPath());
  const rootConfig = rootConfigSnapshot.present ? JSON.parse(rootConfigSnapshot.value) : {};
  return { credentials, rootConfig, rootConfigSnapshot, capturedAt: new Date().toISOString(), status };
}

async function captureCredentialBundle() {
  const current = await captureCredentialState({ requireLogin: true });
  if (!current.status.email && !current.status.orgId) throw new Error("Claude Code did not report a stable account identity. Capture was blocked.");
  return {
    credentials: current.credentials,
    oauthAccount: current.rootConfig?.oauthAccount ?? null,
    userID: current.rootConfig?.userID ?? null,
    capturedAt: current.capturedAt,
    status: current.status,
  };
}

async function hasRunningClaude() {
  return (await probeClaudeProcesses()).status !== "clear";
}

async function atomicWrite(file, contents, mode = 0o600) {
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const temp = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  let handle;
  try {
    handle = await fs.open(temp, "wx", mode);
    await handle.writeFile(contents);
    await handle.sync();
    await handle.close();
    handle = null;
    await fs.rename(temp, file);
    await fs.chmod(file, mode).catch(() => {});
  } catch (error) {
    if (handle) await handle.close().catch(() => {});
    await fs.unlink(temp).catch(() => {});
    throw error;
  }
}

async function writeCredentialValue(source, value, account = null) {
  const parsed = parseCredentialValue(value);
  if (source === "macos-keychain") {
    if (process.platform !== "darwin") throw new Error("macOS Keychain credentials cannot be written on this platform.");
    if (typeof account !== "string" || !account) throw new Error("macOS Keychain account identity is required.");
    await runSecurityWithSecret(["add-generic-password", "-U", "-a", account, "-s", KEYCHAIN_SERVICE, "-w"], value);
    return;
  }
  if (source !== "credentials-file") throw new Error("Unsupported Claude credential adapter.");
  await atomicWrite(credentialsPath(), `${JSON.stringify(parsed, null, 2)}\n`);
}

async function runSecurityWithSecret(args, secret) {
  await new Promise((resolve, reject) => {
    const child = spawn("security", args, { stdio: ["pipe", "ignore", "pipe"] });
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      const error = new Error("macOS Keychain operation timed out.");
      error.code = "KEYCHAIN_TIMEOUT";
      reject(error);
    }, 15000);
    child.stderr.on("data", (chunk) => { if (stderr.length < 4096) stderr += chunk.toString(); });
    child.once("error", (cause) => {
      clearTimeout(timer);
      const error = new Error("macOS Keychain operation could not be started.");
      error.code = "KEYCHAIN_WRITE_FAILED";
      error.cause = cause;
      reject(error);
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else {
        const error = new Error("macOS Keychain rejected the credential update.");
        error.code = "KEYCHAIN_WRITE_FAILED";
        error.detail = stderr ? "security command returned an error" : null;
        reject(error);
      }
    });
    child.stdin.end(`${secret}\n`);
  });
}

function mergeAccountMetadata(rootConfig, bundle) {
  const next = structuredClone(rootConfig);
  if (bundle.oauthAccount) next.oauthAccount = bundle.oauthAccount;
  else delete next.oauthAccount;
  if (bundle.userID) next.userID = bundle.userID;
  else delete next.userID;
  return next;
}

async function applyCredentialBundle(bundle, destinationSource, destinationAccount = null, hooks = {}) {
  parseCredentialValue(bundle?.credentials?.value);
  const currentRoot = await readJson(rootConfigPath(), {});
  const nextRoot = mergeAccountMetadata(currentRoot, bundle);
  await writeCredentialValue(destinationSource, bundle.credentials.value, destinationAccount);
  if (typeof hooks.afterCredentialWrite === "function") await hooks.afterCredentialWrite();
  await atomicWrite(rootConfigPath(), `${JSON.stringify(nextRoot, null, 2)}\n`);
}

async function restoreCredentialState(state) {
  if (!state?.credentials?.source) throw new Error("Recovery state has no credential adapter.");
  if (!isPlainObject(state.rootConfig)) throw new Error("Recovery root configuration is invalid.");
  if (state.credentials.present === false) {
    if (state.credentials.source === "credentials-file") await fs.unlink(credentialsPath()).catch((error) => { if (error.code !== "ENOENT") throw error; });
    else if (state.credentials.source === "macos-keychain") await execFileAsync("security", ["delete-generic-password", "-a", state.credentials.account, "-s", KEYCHAIN_SERVICE], { timeout: 8000 }).catch((error) => { if (Number(error.code) !== 44) throw error; });
    else throw new Error("Unsupported Claude credential adapter.");
  } else if (state.credentials.source === "credentials-file") {
    parseCredentialValue(state.credentials.value);
    await atomicWrite(credentialsPath(), state.credentials.value, state.credentials.mode || 0o600);
  } else {
    parseCredentialValue(state.credentials.value);
    await writeCredentialValue(state.credentials.source, state.credentials.value, state.credentials.account);
  }
  if (state.rootConfigSnapshot?.present) {
    await atomicWrite(rootConfigPath(), state.rootConfigSnapshot.value, state.rootConfigSnapshot.mode || 0o600);
  } else if (state.rootConfigSnapshot && !state.rootConfigSnapshot.present) {
    await fs.unlink(rootConfigPath()).catch((error) => { if (error.code !== "ENOENT") throw error; });
  } else {
    await atomicWrite(rootConfigPath(), `${JSON.stringify(state.rootConfig, null, 2)}\n`);
  }
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function identityMatches(expected, actual) {
  if (!actual?.loggedIn) return false;
  const hasEmail = typeof expected?.email === "string" && expected.email.length > 0;
  const hasOrg = typeof expected?.orgId === "string" && expected.orgId.length > 0;
  if (!hasEmail && !hasOrg) return false;
  if (hasEmail && (typeof actual.email !== "string" || actual.email.toLowerCase() !== expected.email.toLowerCase())) return false;
  if (hasOrg && actual.orgId !== expected.orgId) return false;
  return true;
}

function credentialStateMatches(expected, actual) {
  if (expected?.credentials?.source !== actual?.credentials?.source) return false;
  if (Boolean(expected?.credentials?.present) !== Boolean(actual?.credentials?.present)) return false;
  if ((expected?.credentials?.account || null) !== (actual?.credentials?.account || null)) return false;
  if (expected?.credentials?.value !== actual?.credentials?.value) return false;
  if ((expected?.credentials?.mode || null) !== (actual?.credentials?.mode || null)) return false;
  const expectedRoot = expected?.rootConfigSnapshot;
  const actualRoot = actual?.rootConfigSnapshot;
  if (expectedRoot && actualRoot) return expectedRoot.present === actualRoot.present && expectedRoot.value === actualRoot.value && (expectedRoot.mode || null) === (actualRoot.mode || null);
  return JSON.stringify(expected?.rootConfig ?? {}) === JSON.stringify(actual?.rootConfig ?? {});
}

async function launchClaudeLogin() {
  if (!(await commandExists("claude"))) throw new Error("Claude Code is not installed or is not available on PATH.");
  if (process.platform === "darwin") {
    const command = "claude auth login; printf '\\nLogin command finished. You can close this window.\\n'; read -n 1";
    await execFileAsync("osascript", ["-e", `tell application "Terminal" to do script ${JSON.stringify(command)}`]);
  } else if (process.platform === "win32") {
    spawn("cmd.exe", ["/c", "start", "cmd.exe", "/k", "claude auth login"], { detached: true, stdio: "ignore" }).unref();
  } else {
    const terminals = [["x-terminal-emulator", ["-e", "claude", "auth", "login"]], ["gnome-terminal", ["--", "claude", "auth", "login"]], ["konsole", ["-e", "claude", "auth", "login"]]];
    for (const [command, args] of terminals) {
      if (await commandExists(command)) { spawn(command, args, { detached: true, stdio: "ignore" }).unref(); return; }
    }
    throw new Error("No supported terminal application was found. Run `claude auth login` manually.");
  }
}

module.exports = {
  KEYCHAIN_SERVICE, applyCredentialBundle, atomicWrite, captureCredentialBundle,
  captureCredentialState, credentialStateMatches, getClaudeStatus, hasRunningClaude, identityMatches,
  launchClaudeLogin, mergeAccountMetadata, normalizeStatus, parseCredentialValue,
  probeClaudeProcesses, restoreCredentialState, safeProfileId, writeCredentialValue,
};
