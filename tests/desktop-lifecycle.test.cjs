const test = require("node:test");
const assert = require("node:assert/strict");
const { applyDockMode, shouldHideWindowOnClose } = require("../electron/desktop-lifecycle.cjs");

test("window hiding requires both the preference and a working tray escape path", () => {
  assert.equal(shouldHideWindowOnClose({ isQuitting: false, closeBehavior: "hide", trayAvailable: true }), true);
  assert.equal(shouldHideWindowOnClose({ isQuitting: false, closeBehavior: "hide", trayAvailable: false }), false);
  assert.equal(shouldHideWindowOnClose({ isQuitting: false, closeBehavior: "quit", trayAvailable: true }), false);
  assert.equal(shouldHideWindowOnClose({ isQuitting: true, closeBehavior: "hide", trayAvailable: true }), false);
});

test("menu-bar-only mode never hides the Dock without a working tray", async () => {
  let visible = true;
  const dock = { isVisible: () => visible, hide: async () => { visible = false; }, show: async () => { visible = true; } };
  await applyDockMode({ platform: "darwin", dock, dockMode: "menu-bar-only", trayAvailable: false });
  assert.equal(visible, true);
  await applyDockMode({ platform: "darwin", dock, dockMode: "menu-bar-only", trayAvailable: true });
  assert.equal(visible, false);
  await applyDockMode({ platform: "darwin", dock, dockMode: "dock-and-menu-bar", trayAvailable: true });
  assert.equal(visible, true);
});
