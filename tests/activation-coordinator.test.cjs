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
  return { credentials: { source: "credentials-file", value: JSON.stringify({ synthetic: marker }) }, oauthAccount: null, userID: null, status: { loggedIn: true, email, authMethod: "claude.ai", subscriptionType: "max", orgId: null } };
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
    applyCredentialBundle: async (target, source) => { current = { credentials: { source, value: target.credentials.value }, rootConfig: {}, status: target.status }; },
    restoreCredentialState: async (state) => { current = structuredClone(state); },
    getClaudeStatus: async () => current.status,
    identityMatches,
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
