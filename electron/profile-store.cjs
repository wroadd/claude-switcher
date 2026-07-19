const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");

const STORE_VERSION = 2;
const RECOVERY_VERSION = 1;
const MAX_ACTIVITY = 100;
const MAX_ACCOUNTS = 100;
const MAX_FILE_BYTES = 8 * 1024 * 1024;

function emptyState() {
  return {
    version: STORE_VERSION,
    revision: 0,
    fingerprintSalt: crypto.randomBytes(32).toString("base64"),
    accounts: [],
    activity: [],
    entries: {},
  };
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function assertString(value, name, { nullable = false, max = 512 } = {}) {
  if (nullable && value === null) return;
  if (typeof value !== "string" || value.length > max) throw new Error(`Invalid ${name}.`);
}

function validateState(state) {
  if (!isObject(state) || state.version !== STORE_VERSION) throw new Error("Unsupported profile store version.");
  if (!Number.isSafeInteger(state.revision) || state.revision < 0) throw new Error("Invalid store revision.");
  assertString(state.fingerprintSalt, "fingerprint salt", { max: 256 });
  if (!Array.isArray(state.accounts) || state.accounts.length > MAX_ACCOUNTS) throw new Error("Invalid accounts collection.");
  if (!Array.isArray(state.activity) || state.activity.length > MAX_ACTIVITY) throw new Error("Invalid activity collection.");
  if (!isObject(state.entries) || Object.keys(state.entries).length > MAX_ACCOUNTS) throw new Error("Invalid vault entries.");

  const ids = new Set();
  let activeCount = 0;
  for (const account of state.accounts) {
    if (!isObject(account)) throw new Error("Invalid account record.");
    assertString(account.id, "account id", { max: 128 });
    assertString(account.alias, "account alias", { max: 40 });
    assertString(account.email, "masked email", { nullable: true, max: 320 });
    assertString(account.emailFingerprint, "email fingerprint", { nullable: true, max: 128 });
    assertString(account.authMethod, "authentication method", { max: 128 });
    assertString(account.subscriptionType, "subscription type", { nullable: true, max: 128 });
    assertString(account.createdAt, "created timestamp", { max: 64 });
    assertString(account.lastUsedAt, "last-used timestamp", { nullable: true, max: 64 });
    if (typeof account.active !== "boolean" || ids.has(account.id)) throw new Error("Invalid account identity state.");
    ids.add(account.id);
    if (account.active) activeCount += 1;
    if (typeof state.entries[account.id] !== "string") throw new Error("Account credential snapshot is missing.");
  }
  if (activeCount > 1) throw new Error("Multiple active profiles are not allowed.");
  for (const id of Object.keys(state.entries)) if (!ids.has(id)) throw new Error("Orphaned credential snapshot detected.");
  return state;
}

function maskEmail(email) {
  if (typeof email !== "string" || !email.includes("@")) return null;
  const [local, domain] = email.split("@");
  const visible = local.slice(0, Math.min(2, local.length));
  return `${visible}${"•".repeat(Math.max(3, local.length - visible.length))}@${domain}`;
}

function fingerprint(email, salt) {
  if (typeof email !== "string" || !email.trim()) return null;
  return crypto.createHmac("sha256", Buffer.from(salt, "base64")).update(email.trim().toLowerCase()).digest("hex");
}

class ProfileStore {
  constructor(userDataDir, safeStorage, securityPolicy = null) {
    this.userDataDir = userDataDir;
    this.safeStorage = safeStorage;
    this.securityPolicy = securityPolicy;
    this.storePath = path.join(userDataDir, "store.json");
    this.legacyMetadataPath = path.join(userDataDir, "profiles.json");
    this.legacyVaultPath = path.join(userDataDir, "vault.json");
    this.backupRoot = path.join(userDataDir, "backups");
    this.journalPath = path.join(userDataDir, "activation-journal.json");
    this.mutationTail = Promise.resolve();
    this.readOnlyVersion = null;
    this.corruptInfo = null;
  }

  encryptionAvailable() {
    if (this.securityPolicy) return this.securityPolicy.usable;
    return this.safeStorage.isEncryptionAvailable();
  }

  async readJson(file, fallback) {
    try {
      const stat = await fs.stat(file);
      if (stat.size > MAX_FILE_BYTES) throw new Error("Persistent data exceeds the safe size limit.");
      return JSON.parse(await fs.readFile(file, "utf8"));
    } catch (error) {
      if (error.code === "ENOENT") return structuredClone(fallback);
      throw error;
    }
  }

  async atomicJson(file, value) {
    await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
    const temp = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
    const handle = await fs.open(temp, "wx", 0o600);
    try {
      await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    try {
      await fs.rename(temp, file);
      await fs.chmod(file, 0o600).catch(() => {});
    } catch (error) {
      await fs.unlink(temp).catch(() => {});
      throw error;
    }
  }

  async quarantine(file, reason) {
    const suffix = new Date().toISOString().replace(/[:.]/g, "-");
    const destination = `${file}.corrupt-${suffix}`;
    await fs.rename(file, destination).catch(() => {});
    this.corruptInfo = { code: "STORE_CORRUPT", quarantine: path.basename(destination), reason };
    return emptyState();
  }

  async migrateLegacy() {
    const metadata = await this.readJson(this.legacyMetadataPath, { version: 1, accounts: [], activity: [] });
    const vault = await this.readJson(this.legacyVaultPath, { version: 1, entries: {} });
    if (metadata.version !== 1 || vault.version !== 1 || !Array.isArray(metadata.accounts) || !isObject(vault.entries)) {
      throw new Error("Unsupported legacy profile store.");
    }
    const state = emptyState();
    state.accounts = metadata.accounts.map((account) => ({
      id: String(account.id),
      alias: String(account.alias).trim().slice(0, 40),
      email: maskEmail(account.email),
      emailFingerprint: fingerprint(account.email, state.fingerprintSalt),
      authMethod: typeof account.authMethod === "string" ? account.authMethod : "unknown",
      subscriptionType: typeof account.subscriptionType === "string" ? account.subscriptionType : null,
      active: Boolean(account.active),
      createdAt: typeof account.createdAt === "string" ? account.createdAt : new Date().toISOString(),
      lastUsedAt: typeof account.lastUsedAt === "string" ? account.lastUsedAt : null,
    }));
    state.activity = Array.isArray(metadata.activity) ? metadata.activity.slice(0, MAX_ACTIVITY) : [];
    state.entries = { ...vault.entries };
    validateState(state);
    await this.atomicJson(this.storePath, state);
    await fs.unlink(this.legacyMetadataPath).catch((error) => { if (error.code !== "ENOENT") throw error; });
    await fs.unlink(this.legacyVaultPath).catch((error) => { if (error.code !== "ENOENT") throw error; });
    return state;
  }

  async readState() {
    if (this.corruptInfo) return emptyState();
    try {
      const state = await this.readJson(this.storePath, null);
      if (state) {
        if (Number.isSafeInteger(state.version) && state.version > STORE_VERSION) {
          this.readOnlyVersion = state.version;
          return emptyState();
        }
        return validateState(state);
      }
      return this.migrateLegacy();
    } catch (error) {
      const exists = await fs.stat(this.storePath).then(() => true).catch(() => false);
      if (exists) return this.quarantine(this.storePath, "The profile store is invalid.");
      throw error;
    }
  }

  async writeState(state) {
    validateState(state);
    state.revision += 1;
    await this.atomicJson(this.storePath, state);
  }

  async withMutation(operation) {
    this.assertWritable();
    const previous = this.mutationTail;
    let release;
    this.mutationTail = new Promise((resolve) => { release = resolve; });
    await previous.catch(() => {});
    try { return await operation(); } finally { release(); }
  }

  assertWritable() {
    if (this.readOnlyVersion !== null) {
      const error = new Error(`Profile store version ${this.readOnlyVersion} requires a newer Claude Switcher release.`);
      error.code = "STORE_FUTURE_VERSION";
      throw error;
    }
    if (this.corruptInfo) {
      const error = new Error(`Profile store recovery is required. Quarantine: ${this.corruptInfo.quarantine}`);
      error.code = "STORE_CORRUPT";
      throw error;
    }
  }

  health() {
    if (this.readOnlyVersion !== null) return { mode: "read-only", version: this.readOnlyVersion, reason: "STORE_FUTURE_VERSION" };
    if (this.corruptInfo) return { mode: "recovery-required", version: null, reason: this.corruptInfo.code, quarantine: this.corruptInfo.quarantine };
    return { mode: "ready", version: STORE_VERSION, reason: null };
  }

  async metadata() {
    const state = await this.readState();
    return { version: state.version, revision: state.revision, accounts: state.accounts, activity: state.activity };
  }

  async vault() {
    const state = await this.readState();
    return { version: state.version, revision: state.revision, entries: state.entries };
  }

  activity(id, alias, type, details = null) {
    return { id: crypto.randomUUID(), accountId: id, alias, type, at: new Date().toISOString(), details };
  }

  async add(alias, bundle) {
    return this.withMutation(async () => {
      if (!this.encryptionAvailable()) throw new Error("OS-backed credential encryption is unavailable. No credentials were stored.");
      const clean = typeof alias === "string" ? alias.trim().slice(0, 40) : "";
      if (!clean) throw new Error("Account alias cannot be empty.");
      const state = await this.readState();
      if (state.accounts.length >= MAX_ACCOUNTS) throw new Error("The profile limit has been reached.");
      const emailFingerprint = fingerprint(bundle.status.email, state.fingerprintSalt);
      const duplicate = state.accounts.find((account) => emailFingerprint && account.emailFingerprint === emailFingerprint);
      if (duplicate) throw new Error(`This Claude identity is already saved as “${duplicate.alias}”.`);
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      state.accounts.push({
        id, alias: clean, email: maskEmail(bundle.status.email), emailFingerprint,
        authMethod: bundle.status.authMethod || "unknown",
        subscriptionType: bundle.status.subscriptionType || null,
        active: true, createdAt: now, lastUsedAt: now,
      });
      state.accounts.forEach((account) => { if (account.id !== id) account.active = false; });
      state.activity.unshift(this.activity(id, clean, "captured"));
      state.activity = state.activity.slice(0, MAX_ACTIVITY);
      state.entries[id] = this.safeStorage.encryptString(JSON.stringify(bundle)).toString("base64");
      await this.writeState(state);
      return this.metadata();
    });
  }

  async secret(id) {
    const state = await this.readState();
    if (!state.entries[id]) throw new Error("The encrypted credential snapshot is missing.");
    return JSON.parse(this.safeStorage.decryptString(Buffer.from(state.entries[id], "base64")));
  }

  async markActive(id, details = null) {
    return this.withMutation(async () => {
      const state = await this.readState();
      const selected = state.accounts.find((account) => account.id === id);
      if (!selected) throw new Error("Account profile not found.");
      const now = new Date().toISOString();
      state.accounts.forEach((account) => { account.active = account.id === id; });
      selected.lastUsedAt = now;
      state.activity.unshift(this.activity(id, selected.alias, "activated", details));
      state.activity = state.activity.slice(0, MAX_ACTIVITY);
      await this.writeState(state);
      return this.metadata();
    });
  }

  async recordFailure(id, type, details) {
    return this.withMutation(async () => {
      const state = await this.readState();
      const account = state.accounts.find((item) => item.id === id);
      state.activity.unshift(this.activity(id, account?.alias || "Unknown", type, details));
      state.activity = state.activity.slice(0, MAX_ACTIVITY);
      await this.writeState(state);
    });
  }

  async rename(id, alias) {
    return this.withMutation(async () => {
      const clean = typeof alias === "string" ? alias.trim().slice(0, 40) : "";
      if (!clean) throw new Error("Account alias cannot be empty.");
      const state = await this.readState();
      const account = state.accounts.find((item) => item.id === id);
      if (!account) throw new Error("Account profile not found.");
      account.alias = clean;
      state.activity.unshift(this.activity(id, clean, "renamed"));
      state.activity = state.activity.slice(0, MAX_ACTIVITY);
      await this.writeState(state);
      return this.metadata();
    });
  }

  async remove(id) {
    return this.withMutation(async () => {
      const state = await this.readState();
      const account = state.accounts.find((item) => item.id === id);
      if (!account) throw new Error("Account profile not found.");
      if (account.active) throw new Error("Activate another account before removing the active profile.");
      delete state.entries[id];
      state.accounts = state.accounts.filter((item) => item.id !== id);
      state.activity.unshift(this.activity(id, account.alias, "removed"));
      state.activity = state.activity.slice(0, MAX_ACTIVITY);
      await this.writeState(state);
      return this.metadata();
    });
  }

  async createRecoveryRecord({ transactionId, targetProfileId, adapter, state }) {
    this.assertWritable();
    if (!this.encryptionAvailable()) throw new Error("OS-backed encryption is required for recovery records.");
    const id = `${new Date().toISOString().replace(/[:.]/g, "-")}-${transactionId}`;
    const dir = path.join(this.backupRoot, id);
    const ciphertext = this.safeStorage.encryptString(JSON.stringify(state)).toString("base64");
    const recovery = { version: RECOVERY_VERSION, ciphertext };
    const manifest = {
      version: RECOVERY_VERSION, id, transactionId, targetProfileId, adapter,
      createdAt: new Date().toISOString(), status: "ready",
      sha256: crypto.createHash("sha256").update(ciphertext).digest("hex"),
    };
    await this.atomicJson(path.join(dir, "recovery.json"), recovery);
    await this.atomicJson(path.join(dir, "manifest.json"), manifest);
    return manifest;
  }

  async readRecoveryRecord(id) {
    if (!/^[a-zA-Z0-9_.-]{1,200}$/.test(id)) throw new Error("Invalid recovery identifier.");
    const dir = path.join(this.backupRoot, id);
    const manifest = await this.readJson(path.join(dir, "manifest.json"), null);
    const recovery = await this.readJson(path.join(dir, "recovery.json"), null);
    if (!manifest || manifest.version !== RECOVERY_VERSION || !recovery || recovery.version !== RECOVERY_VERSION) {
      throw new Error("Recovery record is incomplete or unsupported.");
    }
    const actual = crypto.createHash("sha256").update(recovery.ciphertext).digest("hex");
    if (actual !== manifest.sha256) throw new Error("Recovery record integrity check failed.");
    return { manifest, state: JSON.parse(this.safeStorage.decryptString(Buffer.from(recovery.ciphertext, "base64"))) };
  }

  async updateRecoveryStatus(id, status) {
    const allowed = new Set(["ready", "committed", "rolled-back", "rollback-failed"]);
    if (!allowed.has(status)) throw new Error("Invalid recovery status.");
    const file = path.join(this.backupRoot, id, "manifest.json");
    const manifest = await this.readJson(file, null);
    if (!manifest) throw new Error("Recovery manifest not found.");
    manifest.status = status;
    manifest.updatedAt = new Date().toISOString();
    await this.atomicJson(file, manifest);
  }

  async writeJournal(journal) { this.assertWritable(); await this.atomicJson(this.journalPath, { version: 1, ...journal }); }
  async readJournal() { return this.readJson(this.journalPath, null); }
  async clearJournal() { await fs.unlink(this.journalPath).catch((error) => { if (error.code !== "ENOENT") throw error; }); }
}

module.exports = { ProfileStore, STORE_VERSION, maskEmail, validateState };
