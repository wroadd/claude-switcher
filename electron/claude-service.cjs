const { execFile, spawn } = require("node:child_process");
const { promisify } = require("node:util");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const execFileAsync = promisify(execFile);
const KEYCHAIN_SERVICE = "Claude Code-credentials";

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
  try { await execFileAsync(locator, [command]); return true; } catch { return false; }
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

async function readJson(file, fallback = null) {
  try { return JSON.parse(await fs.readFile(file, "utf8")); } catch (error) {
    if (error.code === "ENOENT") return fallback;
    throw error;
  }
}

async function readCurrentCredentials() {
  if (process.platform === "darwin") {
    try {
      const { stdout } = await execFileAsync("security", ["find-generic-password", "-s", KEYCHAIN_SERVICE, "-w"], { maxBuffer: 2 * 1024 * 1024 });
      const value = stdout.trim();
      JSON.parse(value);
      return { source: "macos-keychain", value };
    } catch (error) {
      const fileValue = await fs.readFile(credentialsPath(), "utf8").catch(() => null);
      if (fileValue) { JSON.parse(fileValue); return { source: "credentials-file", value: fileValue }; }
      throw new Error("Claude credentials were not found in macOS Keychain or ~/.claude/.credentials.json.");
    }
  }
  const value = await fs.readFile(credentialsPath(), "utf8").catch(() => null);
  if (!value) throw new Error("Claude credentials were not found at ~/.claude/.credentials.json.");
  JSON.parse(value);
  return { source: "credentials-file", value };
}

async function captureCredentialBundle() {
  const status = await getClaudeStatus();
  if (!status.installed) throw new Error("Claude Code is not installed or is not available on PATH.");
  if (!status.loggedIn) throw new Error("Claude Code is not logged in. Open Claude login, finish authentication, and try again.");
  const credentials = await readCurrentCredentials();
  const rootConfig = await readJson(rootConfigPath(), {});
  return {
    credentials,
    oauthAccount: rootConfig?.oauthAccount ?? null,
    userID: rootConfig?.userID ?? null,
    capturedAt: new Date().toISOString(),
    status,
  };
}

async function hasRunningClaude() {
  if (process.platform === "win32") {
    try {
      const { stdout } = await execFileAsync("tasklist", ["/FI", "IMAGENAME eq claude.exe", "/NH"]);
      return /claude\.exe/i.test(stdout);
    } catch { return false; }
  }
  try { await execFileAsync("pgrep", ["-x", "claude"]); return true; } catch { return false; }
}

async function atomicWrite(file, contents, mode = 0o600) {
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const temp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(temp, contents, { mode });
  await fs.rename(temp, file);
  await fs.chmod(file, mode).catch(() => {});
}

async function backupFile(file, backupDir, label) {
  try {
    const value = await fs.readFile(file);
    await fs.mkdir(backupDir, { recursive: true, mode: 0o700 });
    await fs.writeFile(path.join(backupDir, label), value, { mode: 0o600 });
  } catch (error) { if (error.code !== "ENOENT") throw error; }
}

async function writeCredentials(bundle, backupDir) {
  await backupFile(credentialsPath(), backupDir, "credentials.json");
  await backupFile(rootConfigPath(), backupDir, "claude.json");

  if (process.platform === "darwin" && bundle.credentials.source === "macos-keychain") {
    await execFileAsync("security", ["delete-generic-password", "-s", KEYCHAIN_SERVICE]).catch(() => {});
    await execFileAsync("security", ["add-generic-password", "-U", "-a", os.userInfo().username, "-s", KEYCHAIN_SERVICE, "-w", bundle.credentials.value], { maxBuffer: 2 * 1024 * 1024 });
  } else {
    await atomicWrite(credentialsPath(), `${JSON.stringify(JSON.parse(bundle.credentials.value), null, 2)}\n`);
  }

  const rootConfig = await readJson(rootConfigPath(), {});
  if (bundle.oauthAccount) rootConfig.oauthAccount = bundle.oauthAccount;
  else delete rootConfig.oauthAccount;
  if (bundle.userID) rootConfig.userID = bundle.userID;
  else delete rootConfig.userID;
  await atomicWrite(rootConfigPath(), `${JSON.stringify(rootConfig, null, 2)}\n`);
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
  KEYCHAIN_SERVICE, atomicWrite, captureCredentialBundle, getClaudeStatus,
  hasRunningClaude, launchClaudeLogin, normalizeStatus, safeProfileId, writeCredentials,
};
