const test = require("node:test");
const assert = require("node:assert/strict");
const { assessSecureStorage } = require("../electron/secure-storage-policy.cjs");
const { rendererTarget, authorizeSender } = require("../electron/window-policy.cjs");

test("Linux rejects basic_text and accepts supported secret stores", () => {
  assert.equal(assessSecureStorage({ platform: "linux", encryptionAvailable: true, backend: "basic_text" }).usable, false);
  for (const backend of ["gnome_libsecret", "kwallet", "kwallet5", "kwallet6"]) {
    assert.equal(assessSecureStorage({ platform: "linux", encryptionAvailable: true, backend }).usable, true);
  }
  assert.equal(assessSecureStorage({ platform: "darwin", encryptionAvailable: false }).usable, false);
});

test("packaged renderer ignores development URL and development URL is exact", () => {
  assert.deepEqual(rendererTarget({ isPackaged: true, devUrl: "https://evil.example" }), { kind: "file" });
  assert.equal(rendererTarget({ isPackaged: false, devUrl: "http://localhost:5173" }).url, "http://localhost:5173/");
  assert.throws(() => rendererTarget({ isPackaged: false, devUrl: "http://127.0.0.1:5173" }), /exactly/);
});

test("IPC sender must be the current main frame at the loaded URL", () => {
  const frame = { url: "file:///app/index.html" };
  const contents = { mainFrame: frame, isDestroyed: () => false, getURL: () => frame.url };
  const window = { webContents: contents };
  assert.doesNotThrow(() => authorizeSender({ sender: contents, senderFrame: frame }, window));
  assert.throws(() => authorizeSender({ sender: {}, senderFrame: frame }, window), /Unauthorized/);
  assert.throws(() => authorizeSender({ sender: contents, senderFrame: { url: frame.url } }, window), /Unauthorized/);
});
