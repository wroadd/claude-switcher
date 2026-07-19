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
  const vaultText = await fs.readFile(path.join(dir, "vault.json"), "utf8");
  assert.ok(!vaultText.includes("one@example.com"));
  assert.equal((await store.secret(metadata.accounts[0].id)).status.email, "one@example.com");
});

test("active profile cannot be removed", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "claude-switcher-test-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const store = new ProfileStore(dir, fakeSafeStorage);
  const metadata = await store.add("Personal", bundle("one@example.com"));
  await assert.rejects(() => store.remove(metadata.accounts[0].id), /Activate another account/);
});
