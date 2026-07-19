const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const { safeProfileId } = require("./claude-service.cjs");

const EMPTY = { version: 1, accounts: [], activity: [] };

class ProfileStore {
  constructor(userDataDir, safeStorage) {
    this.userDataDir = userDataDir;
    this.safeStorage = safeStorage;
    this.metadataPath = path.join(userDataDir, "profiles.json");
    this.vaultPath = path.join(userDataDir, "vault.json");
    this.backupRoot = path.join(userDataDir, "backups");
  }

  encryptionAvailable() { return this.safeStorage.isEncryptionAvailable(); }

  async readJson(file, fallback) {
    try { return JSON.parse(await fs.readFile(file, "utf8")); }
    catch (error) { if (error.code === "ENOENT") return structuredClone(fallback); throw error; }
  }

  async atomicJson(file, value) {
    await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
    const temp = `${file}.${process.pid}.tmp`;
    await fs.writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
    await fs.rename(temp, file);
    await fs.chmod(file, 0o600).catch(() => {});
  }

  async metadata() { return this.readJson(this.metadataPath, EMPTY); }
  async vault() { return this.readJson(this.vaultPath, { version: 1, entries: {} }); }

  activity(id, alias, type) { return { id: crypto.randomUUID(), accountId: id, alias, type, at: new Date().toISOString() }; }

  async add(alias, bundle) {
    if (!this.encryptionAvailable()) throw new Error("OS-backed credential encryption is unavailable. No credentials were stored.");
    const metadata = await this.metadata();
    const duplicate = metadata.accounts.find((account) => account.email && account.email === bundle.status.email);
    if (duplicate) throw new Error(`This Claude identity is already saved as “${duplicate.alias}”.`);
    const vault = await this.vault();
    const id = safeProfileId(alias);
    const now = new Date().toISOString();
    metadata.accounts.push({
      id, alias, email: bundle.status.email, authMethod: bundle.status.authMethod,
      subscriptionType: bundle.status.subscriptionType, active: true, createdAt: now, lastUsedAt: now,
    });
    metadata.accounts.forEach((account) => { if (account.id !== id) account.active = false; });
    metadata.activity.unshift(this.activity(id, alias, "captured"));
    metadata.activity = metadata.activity.slice(0, 100);
    vault.entries[id] = this.safeStorage.encryptString(JSON.stringify(bundle)).toString("base64");
    await this.atomicJson(this.vaultPath, vault);
    await this.atomicJson(this.metadataPath, metadata);
    return metadata;
  }

  async secret(id) {
    const vault = await this.vault();
    if (!vault.entries[id]) throw new Error("The encrypted credential snapshot is missing.");
    return JSON.parse(this.safeStorage.decryptString(Buffer.from(vault.entries[id], "base64")));
  }

  async markActive(id) {
    const metadata = await this.metadata();
    const selected = metadata.accounts.find((account) => account.id === id);
    if (!selected) throw new Error("Account profile not found.");
    const now = new Date().toISOString();
    metadata.accounts.forEach((account) => { account.active = account.id === id; });
    selected.lastUsedAt = now;
    metadata.activity.unshift(this.activity(id, selected.alias, "activated"));
    metadata.activity = metadata.activity.slice(0, 100);
    await this.atomicJson(this.metadataPath, metadata);
    return metadata;
  }

  async rename(id, alias) {
    const clean = alias.trim().slice(0, 40);
    if (!clean) throw new Error("Account alias cannot be empty.");
    const metadata = await this.metadata();
    const account = metadata.accounts.find((item) => item.id === id);
    if (!account) throw new Error("Account profile not found.");
    account.alias = clean;
    metadata.activity.unshift(this.activity(id, clean, "renamed"));
    await this.atomicJson(this.metadataPath, metadata);
    return metadata;
  }

  async remove(id) {
    const metadata = await this.metadata();
    const account = metadata.accounts.find((item) => item.id === id);
    if (!account) throw new Error("Account profile not found.");
    if (account.active) throw new Error("Activate another account before removing the active profile.");
    const vault = await this.vault();
    delete vault.entries[id];
    metadata.accounts = metadata.accounts.filter((item) => item.id !== id);
    metadata.activity.unshift(this.activity(id, account.alias, "removed"));
    await this.atomicJson(this.vaultPath, vault);
    await this.atomicJson(this.metadataPath, metadata);
    return metadata;
  }

  backupDir() {
    return path.join(this.backupRoot, new Date().toISOString().replace(/[:.]/g, "-"));
  }
}

module.exports = { ProfileStore };
