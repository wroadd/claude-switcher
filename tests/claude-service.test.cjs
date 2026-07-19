const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { atomicWrite, credentialStateMatches, identityMatches, normalizeStatus, restoreCredentialState, safeProfileId } = require("../electron/claude-service.cjs");

test("normalizeStatus exposes only expected identity metadata", () => {
  assert.deepEqual(normalizeStatus({
    loggedIn: true, email: "person@example.com", authMethod: "claude.ai",
    subscriptionType: "max", orgId: "org-1", unexpectedSecretField: "synthetic-value",
  }), {
    installed: true, loggedIn: true, email: "person@example.com",
    authMethod: "claude.ai", subscriptionType: "max", orgId: "org-1",
  });
});

test("identity and credential-state comparison is strict without exposing secrets", () => {
  assert.equal(identityMatches({ email: "one@example.com", orgId: "org" }, { loggedIn: true, email: "one@example.com", orgId: "org" }), true);
  assert.equal(identityMatches({ email: "one@example.com" }, { loggedIn: true, email: "two@example.com" }), false);
  assert.equal(identityMatches({ email: null, orgId: null }, { loggedIn: true, email: "one@example.com" }), false);
  assert.equal(identityMatches({ orgId: "org" }, { loggedIn: true, orgId: null }), false);
  const first = { credentials: { source: "credentials-file", value: "{\"a\":1}" }, rootConfigSnapshot: { present: true, value: "{}" } };
  assert.equal(credentialStateMatches(first, structuredClone(first)), true);
  assert.equal(credentialStateMatches(first, { ...structuredClone(first), credentials: { source: "credentials-file", value: "{\"a\":2}" } }), false);
});

test("file recovery restores exact credential and root-config bytes", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "claude-switcher-service-"));
  t.after(async () => { delete process.env.CLAUDE_CONFIG_DIR; await fs.rm(dir, { recursive: true, force: true }); });
  process.env.CLAUDE_CONFIG_DIR = dir;
  const credentials = "{\n  \"synthetic\": true\n}\n";
  const root = "{\"theme\":\"dark\"}\n";
  await restoreCredentialState({
    credentials: { source: "credentials-file", present: true, account: null, value: credentials, mode: 0o640 },
    rootConfig: { theme: "dark" },
    rootConfigSnapshot: { present: true, value: root, mode: 0o640 },
  });
  assert.equal(await fs.readFile(path.join(dir, ".credentials.json"), "utf8"), credentials);
  assert.equal(await fs.readFile(path.join(dir, ".claude.json"), "utf8"), root);
});

test("file recovery can restore original absence", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "claude-switcher-service-"));
  t.after(async () => { delete process.env.CLAUDE_CONFIG_DIR; await fs.rm(dir, { recursive: true, force: true }); });
  process.env.CLAUDE_CONFIG_DIR = dir;
  await fs.writeFile(path.join(dir, ".credentials.json"), "{}\n");
  await fs.writeFile(path.join(dir, ".claude.json"), "{}\n");
  await restoreCredentialState({ credentials: { source: "credentials-file", present: false, account: null, value: null, mode: null }, rootConfig: {}, rootConfigSnapshot: { present: false, value: null, mode: null } });
  await assert.rejects(() => fs.stat(path.join(dir, ".credentials.json")), /ENOENT/);
  await assert.rejects(() => fs.stat(path.join(dir, ".claude.json")), /ENOENT/);
});

test("atomic credential write removes plaintext temp file when rename fails", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "claude-switcher-service-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const destination = path.join(dir, "destination-is-directory");
  await fs.mkdir(destination);
  await assert.rejects(() => atomicWrite(destination, "plaintext-canary"));
  assert.deepEqual((await fs.readdir(dir)).sort(), ["destination-is-directory"]);
});

test("safeProfileId creates a filesystem-safe unique id", () => {
  const id = safeProfileId("Munkám / Personal");
  assert.match(id, /^munkam-personal-[a-z0-9]+$/);
  assert.ok(!id.includes("/"));
});
