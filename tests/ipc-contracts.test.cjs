const test = require("node:test");
const assert = require("node:assert/strict");
const { CHANNELS, parseRequest } = require("../electron/ipc-contracts.cjs");

test("IPC contracts normalize expected envelopes", () => {
  assert.deepEqual(parseRequest(CHANNELS.capture, { alias: "  Work  " }), { alias: "Work" });
  assert.deepEqual(parseRequest(CHANNELS.rename, { id: "profile-1", alias: "Home" }), { id: "profile-1", alias: "Home" });
  assert.deepEqual(parseRequest(CHANNELS.state, {}), {});
  assert.deepEqual(parseRequest(CHANNELS.restore, { id: "2026-07-19-recovery.id" }), { id: "2026-07-19-recovery.id" });
  assert.deepEqual(parseRequest(CHANNELS.retryRecovery, {}), {});
  assert.deepEqual(parseRequest(CHANNELS.retention, { value: 20 }), { value: 20 });
  assert.deepEqual(parseRequest(CHANNELS.closeBehavior, { value: "hide" }), { value: "hide" });
  assert.deepEqual(parseRequest(CHANNELS.dockMode, { value: "menu-bar-only" }), { value: "menu-bar-only" });
});

test("IPC contracts reject coercion, unknown fields, controls, and hostile IDs", () => {
  assert.throws(() => parseRequest(CHANNELS.capture, { alias: 12 }), /must be text/);
  assert.throws(() => parseRequest(CHANNELS.capture, { alias: "ok", extra: true }), /fields/);
  assert.throws(() => parseRequest(CHANNELS.capture, { alias: "bad\u0000name" }), /printable/);
  assert.throws(() => parseRequest(CHANNELS.activate, { id: "../../secret" }), /identifier/);
  assert.throws(() => parseRequest(CHANNELS.state, null), /Invalid request/);
  assert.throws(() => parseRequest(CHANNELS.retention, { value: 2 }), /between 5 and 100/);
  assert.throws(() => parseRequest(CHANNELS.closeBehavior, { value: "background" }), /close behavior/);
  assert.throws(() => parseRequest(CHANNELS.dockMode, { value: "hidden" }), /Dock mode/);
});
