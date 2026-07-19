const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { ProfileStore } = require("../electron/profile-store.cjs");

const fakeSafeStorage = {
  isEncryptionAvailable: () => true,
  encryptString: (value) => Buffer.from(`enc:${value}`),
  decryptString: (value) => value.toString().slice(4),
};

function bundle(email) {
  return { credentials: { source: "credentials-file", value: "{}" }, oauthAccount: null, userID: null, status: { email, authMethod: "claude.ai", subscriptionType: "max" } };
}

test("profile store encrypts secrets and maintains one active account", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "claude-switcher-test-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const store = new ProfileStore(dir, fakeSafeStorage);
  await store.add("Personal", bundle("one@example.com"));
  await store.add("Work", bundle("two@example.com"));
  const metadata = await store.metadata();
  assert.equal(metadata.accounts.length, 2);
  assert.equal(metadata.accounts.filter((item) => item.active).length, 1);
  assert.equal(metadata.accounts.find((item) => item.active).alias, "Work");
  const storeText = await fs.readFile(path.join(dir, "store.json"), "utf8");
  assert.ok(!storeText.includes("one@example.com"));
  assert.equal((await store.secret(metadata.accounts[0].id)).status.email, "one@example.com");
  assert.equal(metadata.version, 2);
  assert.equal(metadata.revision, 2);
});

test("legacy v1 metadata and vault migrate without changing encrypted entries", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "claude-switcher-test-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const encrypted = fakeSafeStorage.encryptString(JSON.stringify(bundle("legacy@example.com"))).toString("base64");
  await fs.writeFile(path.join(dir, "profiles.json"), JSON.stringify({ version: 1, accounts: [{ id: "legacy-1", alias: "Legacy", email: "legacy@example.com", authMethod: "claude.ai", subscriptionType: null, active: true, createdAt: new Date().toISOString(), lastUsedAt: null }], activity: [] }));
  await fs.writeFile(path.join(dir, "vault.json"), JSON.stringify({ version: 1, entries: { "legacy-1": encrypted } }));
  const store = new ProfileStore(dir, fakeSafeStorage);
  const metadata = await store.metadata();
  assert.equal(metadata.version, 2);
  assert.equal(metadata.accounts[0].email.includes("legacy@example.com"), false);
  assert.equal((await store.vault()).entries["legacy-1"], encrypted);
  await assert.rejects(() => fs.stat(path.join(dir, "profiles.json")), /ENOENT/);
});

test("active profile cannot be removed", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "claude-switcher-test-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const store = new ProfileStore(dir, fakeSafeStorage);
  const metadata = await store.add("Personal", bundle("one@example.com"));
  await assert.rejects(() => store.remove(metadata.accounts[0].id), /Activate another account/);
});

test("future store versions remain untouched and read-only", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "claude-switcher-test-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const future = '{"version":99,"future":"preserve-me"}\n';
  await fs.writeFile(path.join(dir, "store.json"), future);
  const store = new ProfileStore(dir, fakeSafeStorage);
  assert.equal((await store.metadata()).accounts.length, 0);
  assert.equal(store.health().mode, "read-only");
  await assert.rejects(() => store.add("Blocked", bundle("blocked@example.com")), /newer Claude Switcher/);
  assert.equal(await fs.readFile(path.join(dir, "store.json"), "utf8"), future);
});

test("corrupt current store is quarantined and mutations stay blocked", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "claude-switcher-test-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  await fs.writeFile(path.join(dir, "store.json"), "not-json");
  const store = new ProfileStore(dir, fakeSafeStorage);
  assert.equal((await store.metadata()).accounts.length, 0);
  assert.equal(store.health().mode, "recovery-required");
  await assert.rejects(() => store.rename("missing", "Name"), /recovery is required/);
  assert.match(store.health().quarantine, /^store\.json\.corrupt-/);
});

test("configurable recovery retention prunes only oldest terminal records", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "claude-switcher-test-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const store = new ProfileStore(dir, fakeSafeStorage);
  const metadata = await store.add("Personal", bundle("one@example.com"));
  const state = { credentials: { source: "credentials-file", present: true, account: null, value: "{}", mode: 0o600 }, rootConfig: {}, rootConfigSnapshot: { present: false, value: null, mode: null }, status: { loggedIn: true, email: "one@example.com", orgId: null } };
  for (let index = 0; index < 7; index += 1) {
    const record = await store.createRecoveryRecord({ transactionId: `00000000-0000-4000-8000-0000000000${String(index).padStart(2, "0")}`, targetProfileId: metadata.accounts[0].id, adapter: "credentials-file", state });
    await store.updateRecoveryStatus(record.id, index === 0 ? "rollback-failed" : "committed");
  }
  await store.setRecoveryRetention(5);
  const records = await store.listRecoveryRecords();
  assert.equal(records.filter((item) => item.status === "committed").length, 5);
  assert.equal(records.some((item) => item.status === "rollback-failed"), true);
  assert.equal((await store.metadata()).preferences.recoveryRetention, 5);
});
