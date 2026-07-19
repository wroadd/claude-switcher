const test = require("node:test");
const assert = require("node:assert/strict");
const { registerAuthorizedHandler } = require("../electron/ipc-boundary.cjs");
const { CHANNELS } = require("../electron/ipc-contracts.cjs");

function fixture() {
  const handlers = new Map();
  const ipcMain = { handle: (channel, handler) => handlers.set(channel, handler) };
  const frame = { url: "file:///app/index.html" };
  const contents = { mainFrame: frame, isDestroyed: () => false, getURL: () => frame.url };
  const window = { webContents: contents };
  return { handlers, ipcMain, frame, contents, window };
}

test("registered IPC handler authorizes and validates before calling domain operation", async () => {
  const f = fixture();
  let calls = 0;
  registerAuthorizedHandler({ ipcMain: f.ipcMain, channel: CHANNELS.capture, getWindow: () => f.window, operation: async (request) => { calls += 1; return request; } });
  const handler = f.handlers.get(CHANNELS.capture);
  assert.deepEqual(await handler({ sender: f.contents, senderFrame: f.frame }, { alias: " Work " }), { alias: "Work" });
  assert.equal(calls, 1);
  await assert.rejects(() => handler({ sender: {}, senderFrame: f.frame }, { alias: "Work" }), /Unauthorized/);
  await assert.rejects(() => handler({ sender: f.contents, senderFrame: f.frame }, { alias: 7 }), /must be text/);
  assert.equal(calls, 1);
});

test("destroyed, child-frame, and wrong-URL senders never reach the operation", async () => {
  const f = fixture();
  let calls = 0;
  registerAuthorizedHandler({ ipcMain: f.ipcMain, channel: CHANNELS.state, getWindow: () => f.window, operation: async () => { calls += 1; } });
  const handler = f.handlers.get(CHANNELS.state);
  await assert.rejects(() => handler({ sender: f.contents, senderFrame: { url: f.frame.url } }, {}), /Unauthorized/);
  f.frame.url = "https://wrong.example";
  f.contents.getURL = () => "file:///app/index.html";
  await assert.rejects(() => handler({ sender: f.contents, senderFrame: f.frame }, {}), /Unauthorized/);
  f.contents.isDestroyed = () => true;
  await assert.rejects(() => handler({ sender: f.contents, senderFrame: f.frame }, {}), /Unauthorized/);
  assert.equal(calls, 0);
});
