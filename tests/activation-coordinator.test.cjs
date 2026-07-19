const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { ProfileStore } = require("../electron/profile-store.cjs");
const { ActivationCoordinator } = require("../electron/activation-coordinator.cjs");
const { identityMatches } = require("../electron/claude-service.cjs");

const safeStorage = {
  isEncryptionAvailable: () => true,
  encryptString: (value) => Buffer.from([...value].reverse().join("")),
  decryptString: (value) => [...value.toString()].reverse().join(""),
};

function bundle(email, marker) {
  return { credentials: { source: "credentials-file", present: true, account: null, value: JSON.stringify({ synthetic: marker }), mode: 0o600 }, oauthAccount: null, userID: null, status: { loggedIn: true, email, authMethod: "claude.ai", subscriptionType: "max", orgId: null } };
}

async function fixture(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "claude-switcher-activation-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const store = new ProfileStore(dir, safeStorage);
  let metadata = await store.add("Previous", bundle("previous@example.com", "previous-canary"));
  const previousId = metadata.accounts[0].id;
  metadata = await store.add("Target", bundle("target@example.com", "target-canary"));
  const targetId = metadata.accounts.find((item) => item.alias === "Target").id;
  await store.markActive(previousId);
  let current = { credentials: bundle("previous@example.com", "previous-canary").credentials, rootConfig: {}, status: bundle("previous@example.com", "previous-canary").status };
  const adapter = {
    probeClaudeProcesses: async () => ({ status: "clear" }),
    captureCredentialState: async () => structuredClone(current),
    applyCredentialBundle: async (target, source) => { current = { credentials: { ...target.credentials, source }, rootConfig: {}, status: target.status }; },
    restoreCredentialState: async (state) => { current = structuredClone(state); },
    getClaudeStatus: async () => current.status,
    identityMatches,
    credentialStateMatches: (expected, actual) => JSON.stringify(expected) === JSON.stringify(actual),
  };
  return { dir, store, adapter, previousId, targetId, current: () => current };
}

test("activation commits metadata only after identity verification", async (t) => {
  const f = await fixture(t);
  const result = await new ActivationCoordinator({ store: f.store, adapter: f.adapter }).activate(f.targetId);
  assert.ok(result.recoveryId);
  assert.equal((await f.store.metadata()).accounts.find((item) => item.active).id, f.targetId);
  assert.equal((await f.store.readRecoveryRecord(result.recoveryId)).manifest.status, "committed");
  assert.equal(await f.store.readJournal(), null);
  const disk = await fs.readFile(path.join(f.dir, "backups", result.recoveryId, "recovery.json"), "utf8");
  assert.equal(disk.includes("previous-canary"), false);
});

test("startup rolls back an interrupted applied journal", async (t) => {
  const f = await fixture(t);
  const previous = structuredClone(f.current());
  const transactionId = "00000000-0000-4000-8000-000000000001";
  const record = await f.store.createRecoveryRecord({ transactionId, targetProfileId: f.targetId, adapter: "credentials-file", state: previous });
  await f.store.writeJournal({ transactionId, recoveryId: record.id, targetProfileId: f.targetId, previousActiveId: f.previousId, adapter: "credentials-file", phase: "applied", updatedAt: new Date().toISOString() });
  await f.adapter.applyCredentialBundle(await f.store.secret(f.targetId), "credentials-file");
  const result = await new ActivationCoordinator({ store: f.store, adapter: f.adapter }).recoverPending();
  assert.equal(result.status, "recovered");
  assert.equal(f.current().status.email, "previous@example.com");
  assert.equal(await f.store.readJournal(), null);
});

test("startup finalizes a verified metadata commit instead of rolling it back", async (t) => {
  const f = await fixture(t);
  const previous = structuredClone(f.current());
  const transactionId = "00000000-0000-4000-8000-000000000002";
  const record = await f.store.createRecoveryRecord({ transactionId, targetProfileId: f.targetId, adapter: "credentials-file", state: previous });
  await f.adapter.applyCredentialBundle(await f.store.secret(f.targetId), "credentials-file");
  await f.store.markActive(f.targetId);
  await f.store.writeJournal({ transactionId, recoveryId: record.id, targetProfileId: f.targetId, previousActiveId: f.previousId, adapter: "credentials-file", phase: "metadata-committed", updatedAt: new Date().toISOString() });
  const result = await new ActivationCoordinator({ store: f.store, adapter: f.adapter }).recoverPending();
  assert.equal(result.status, "recovered");
  assert.equal(f.current().status.email, "target@example.com");
  assert.equal((await f.store.readRecoveryRecord(record.id)).manifest.status, "committed");
});

test("failure after credential apply restores previous identity and active metadata", async (t) => {
  const f = await fixture(t);
  const coordinator = new ActivationCoordinator({ store: f.store, adapter: f.adapter, failpoint: async (name) => { if (name === "after-credential-apply") throw new Error("synthetic failure"); } });
  await assert.rejects(() => coordinator.activate(f.targetId), /previous login was restored/);
  assert.equal(f.current().status.email, "previous@example.com");
  assert.equal((await f.store.metadata()).accounts.find((item) => item.active).id, f.previousId);
  assert.equal(await f.store.readJournal(), null);
});

test("process probe uncertainty fails closed before mutation", async (t) => {
  const f = await fixture(t);
  f.adapter.probeClaudeProcesses = async () => ({ status: "unknown" });
  await assert.rejects(() => new ActivationCoordinator({ store: f.store, adapter: f.adapter }).activate(f.targetId), /blocked for safety/);
  assert.equal(f.current().status.email, "previous@example.com");
});

test("post-commit interruption finalizes a verified activation", async (t) => {
  const f = await fixture(t);
  const coordinator = new ActivationCoordinator({ store: f.store, adapter: f.adapter, failpoint: async (name) => { if (name === "after-metadata-commit") throw new Error("simulated crash boundary"); } });
  const result = await coordinator.activate(f.targetId);
  assert.ok(result.recoveryId);
  assert.equal((await f.store.metadata()).accounts.find((item) => item.active).id, f.targetId);
  assert.equal(await f.store.readJournal(), null);
});

test("manual recovery restore first backs up current state and activates matching profile", async (t) => {
  const f = await fixture(t);
  const coordinator = new ActivationCoordinator({ store: f.store, adapter: f.adapter });
  const activation = await coordinator.activate(f.targetId);
  assert.equal(f.current().status.email, "target@example.com");
  const restored = await coordinator.restore(activation.recoveryId);
  assert.equal(restored.restoredFrom, activation.recoveryId);
  assert.equal(f.current().status.email, "previous@example.com");
  assert.equal((await f.store.metadata()).accounts.find((item) => item.active).id, f.previousId);
  const records = await f.store.listRecoveryRecords();
  assert.equal(records.every((item) => item.integrity === "valid"), true);
  assert.equal(records.length, 2);
});
