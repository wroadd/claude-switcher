const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const {
  createDiagnostics,
  DIAGNOSTIC_ERROR_CODES,
} = require("../electron/diagnostics.cjs");

const KEY = Buffer.alloc(32, 7);
const NOW = new Date("2026-07-19T12:00:00.000Z");

function diagnostics(options = {}) {
  return createDiagnostics({ pseudonymKey: KEY, now: () => NOW, ...options });
}

function unsafeInput() {
  return {
    app: { version: "0.2.0", packaged: true, ignored: "do-not-copy" },
    runtime: { platform: "darwin", architecture: "arm64", nodeVersion: "22.0.0", electronVersion: "37.2.0", locale: "en-GB" },
    storageHealth: { mode: "ready", version: 2, reason: null, quarantine: "/Users/alice/private/store.json" },
    capabilities: { secureStorage: true, processDetection: true, recoveryRecords: true },
    profiles: [{
      id: "profile-123", alias: "Alice Personal", email: "alice@example.com", active: true,
      authMethod: "claude.ai", subscriptionType: "max", createdAt: "2026-01-01T00:00:00Z",
      lastUsedAt: "2026-07-18T00:00:00Z", credentials: { accessToken: "secret-canary" },
    }],
    events: [{
      code: "PROFILE_ACTIVATED", errorCode: null, profileId: "profile-123", alias: "Alice Personal",
      path: "/Users/alice/.claude/.credentials.json", at: "2026-07-19T11:00:00Z",
      rawCommandOutput: "alice@example.com secret-canary", stderr: "secret-canary",
    }],
  };
}

test("build emits a bounded metadata-only allowlist with stable pseudonyms", () => {
  const { bundle, serialized } = diagnostics().build(unsafeInput());
  assert.equal(bundle.schemaVersion, 1);
  assert.equal(bundle.generatedAt, NOW.toISOString());
  assert.deepEqual(bundle.counts, { profiles: 1, activeProfiles: 1, events: 1 });
  assert.match(bundle.profiles[0].profileRef, /^profile_[a-f0-9]{16}$/);
  assert.match(bundle.profiles[0].aliasRef, /^alias_[a-f0-9]{16}$/);
  assert.match(bundle.events[0].pathRef, /^path_[a-f0-9]{16}$/);
  assert.equal(bundle.profiles[0].profileRef, bundle.events[0].profileRef);
  for (const forbidden of ["profile-123", "Alice Personal", "alice@example.com", "/Users/alice", "secret-canary", "credentials", "rawCommandOutput", "quarantine"])
    assert.equal(serialized.includes(forbidden), false, `must exclude ${forbidden}`);
});

test("unknown event and runtime errors collapse to stable non-sensitive codes", () => {
  const input = unsafeInput();
  input.events[0].code = "user supplied event details";
  input.events[0].errorCode = "ENOENT: /Users/alice/.claude";
  const event = diagnostics().build(input).bundle.events[0];
  assert.equal(event.eventCode, "EVENT_OTHER");
  assert.equal(event.errorCode, "ERROR_OTHER");
});

test("profile and event limits are enforced before serialization", () => {
  const input = unsafeInput();
  input.profiles = Array.from({ length: 8 }, (_, index) => ({ id: `id-${index}`, alias: `name-${index}` }));
  input.events = Array.from({ length: 9 }, (_, index) => ({ code: "PROFILE_CAPTURED", profileId: `id-${index}` }));
  const bundle = diagnostics({ maxProfiles: 2, maxEvents: 3 }).build(input).bundle;
  assert.equal(bundle.profiles.length, 2);
  assert.equal(bundle.events.length, 3);
  assert.deepEqual(bundle.counts, { profiles: 2, activeProfiles: 0, events: 3 });
});

test("canary scan refuses export before opening the destination", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "claude-switcher-diagnostics-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const destination = path.join(dir, "support.json");
  const input = unsafeInput();
  input.app.version = "release-secret-canary";
  input.canaries = ["secret-canary"];
  await assert.rejects(
    () => diagnostics().exportBundle(destination, input),
    (error) => error.code === DIAGNOSTIC_ERROR_CODES.UNSAFE_CONTENT,
  );
  await assert.rejects(() => fs.stat(destination), /ENOENT/);
});

test("generic safety scan rejects full emails and absolute paths", () => {
  const withEmail = unsafeInput();
  withEmail.app.version = "contact@example.com";
  assert.throws(() => diagnostics().build(withEmail), (error) => error.code === DIAGNOSTIC_ERROR_CODES.UNSAFE_CONTENT);
  const withPath = unsafeInput();
  withPath.app.version = "/Users/alice/private";
  assert.throws(() => diagnostics().build(withPath), (error) => error.code === DIAGNOSTIC_ERROR_CODES.UNSAFE_CONTENT);
});

test("size limit refuses oversized metadata", () => {
  const input = unsafeInput();
  input.app.version = "x".repeat(160);
  assert.throws(
    () => diagnostics({ maxBytes: 512 }).build(input),
    (error) => error.code === DIAGNOSTIC_ERROR_CODES.SIZE_LIMIT,
  );
});

test("export is atomic, private, and leaves no temporary file", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "claude-switcher-diagnostics-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const destination = path.join(dir, "nested", "support.json");
  const result = await diagnostics().exportBundle(destination, unsafeInput());
  assert.equal(result.code, "DIAGNOSTICS_EXPORTED");
  assert.deepEqual(JSON.parse(await fs.readFile(destination, "utf8")), result.bundle);
  if (process.platform !== "win32") assert.equal((await fs.stat(destination)).mode & 0o777, 0o600);
  assert.deepEqual(await fs.readdir(path.dirname(destination)), ["support.json"]);
});

test("write failures use a stable code and clean up the temporary file", async () => {
  let unlinked = null;
  const fakeFs = {
    mkdir: async () => {},
    open: async (file, flags, mode) => {
      assert.equal(flags, "wx");
      assert.equal(mode, 0o600);
      return { writeFile: async () => {}, sync: async () => { throw new Error("disk failure"); }, close: async () => {} };
    },
    rename: async () => { throw new Error("must not rename"); },
    chmod: async () => {},
    unlink: async (file) => { unlinked = file; },
  };
  await assert.rejects(
    () => diagnostics({ fs: fakeFs }).exportBundle("/safe/support.json", unsafeInput()),
    (error) => error.code === DIAGNOSTIC_ERROR_CODES.WRITE_FAILED && error.cause?.message === "disk failure",
  );
  assert.match(unlinked, /\.tmp$/);
});
