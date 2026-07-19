const test = require("node:test");
const assert = require("node:assert/strict");
const { assessSecureStorage } = require("../electron/secure-storage-policy.cjs");
const { rendererTarget, authorizeSender, configureWindowSecurity } = require("../electron/window-policy.cjs");

test("Linux rejects basic_text and accepts supported secret stores", () => {
  assert.equal(assessSecureStorage({ platform: "linux", encryptionAvailable: true, backend: "basic_text" }).usable, false);
  for (const backend of ["gnome_libsecret", "kwallet", "kwallet5", "kwallet6"]) {
    assert.equal(assessSecureStorage({ platform: "linux", encryptionAvailable: true, backend }).usable, true);
  }
  assert.equal(assessSecureStorage({ platform: "darwin", encryptionAvailable: false }).usable, false);
});

test("window security installs deny hooks and strict packaged CSP", () => {
  const listeners = new Map();
  let openHandler;
  let permissionCheck;
  let permissionRequest;
  let headersHandler;
  const contents = {
    setWindowOpenHandler: (handler) => { openHandler = handler; },
    on: (name, handler) => listeners.set(name, handler),
    session: {
      setPermissionCheckHandler: (handler) => { permissionCheck = handler; },
      setPermissionRequestHandler: (handler) => { permissionRequest = handler; },
      webRequest: { onHeadersReceived: (handler) => { headersHandler = handler; } },
    },
  };
  configureWindowSecurity(contents, { packaged: true });
  assert.deepEqual(openHandler(), { action: "deny" });
  for (const eventName of ["will-navigate", "will-frame-navigate", "will-attach-webview"]) {
    let prevented = false;
    listeners.get(eventName)({ preventDefault: () => { prevented = true; } });
    assert.equal(prevented, true);
  }
  assert.equal(permissionCheck(), false);
  permissionRequest(null, null, (allowed) => assert.equal(allowed, false));
  headersHandler({ responseHeaders: {} }, (result) => assert.match(result.responseHeaders["Content-Security-Policy"][0], /connect-src 'none'/));
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
