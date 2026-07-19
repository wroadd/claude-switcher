const test = require("node:test");
const assert = require("node:assert/strict");
const { CHANNELS, parseRequest } = require("../electron/ipc-contracts.cjs");

test("IPC contracts normalize expected envelopes", () => {
  assert.deepEqual(parseRequest(CHANNELS.capture, { alias: "  Work  " }), { alias: "Work" });
  assert.deepEqual(parseRequest(CHANNELS.rename, { id: "profile-1", alias: "Home" }), { id: "profile-1", alias: "Home" });
  assert.deepEqual(parseRequest(CHANNELS.state, {}), {});
});

test("IPC contracts reject coercion, unknown fields, controls, and hostile IDs", () => {
  assert.throws(() => parseRequest(CHANNELS.capture, { alias: 12 }), /must be text/);
  assert.throws(() => parseRequest(CHANNELS.capture, { alias: "ok", extra: true }), /fields/);
  assert.throws(() => parseRequest(CHANNELS.capture, { alias: "bad\u0000name" }), /printable/);
  assert.throws(() => parseRequest(CHANNELS.activate, { id: "../../secret" }), /identifier/);
  assert.throws(() => parseRequest(CHANNELS.state, null), /Invalid request/);
});
