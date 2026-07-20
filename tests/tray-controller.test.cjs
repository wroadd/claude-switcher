const test = require("node:test");
const assert = require("node:assert/strict");
const { createTrayController } = require("../electron/tray-controller.cjs");

function fixture(overrides = {}) {
  const trays = [];
  class FakeTray {
    constructor(image) { this.image = image; this.handlers = {}; trays.push(this); }
    on(name, handler) { this.handlers[name] = handler; }
    setToolTip(value) { this.tooltip = value; }
    setContextMenu(value) { this.menu = value; }
    destroy() { this.destroyed = true; }
  }
  const image = { isEmpty: () => false, resize() { return this; }, setTemplateImage(value) { this.template = value; } };
  const state = {
    accounts: [
      { id: "personal-id", alias: "Personal", email: "pe•••@example.com", active: true },
      { id: "work-id", alias: "Work", email: "wo•••@company.com", active: false },
    ],
    store: { mode: "ready" }, recovery: { status: "clear" }, security: { encryptionAvailable: true },
    preferences: { dockMode: "dock-and-menu-bar", trayDisplayMode: "aliases" },
  };
  const calls = { activated: [], shown: 0, quit: 0, dock: [] };
  const controller = createTrayController({
    Tray: FakeTray,
    Menu: { buildFromTemplate: (template) => template },
    nativeImage: { createFromPath: () => image }, iconPath: "/safe/icon.png", platform: "darwin",
    getState: async () => state,
    activate: async (id) => { calls.activated.push(id); },
    showWindow: () => { calls.shown += 1; }, quit: () => { calls.quit += 1; },
    setDockMode: async (mode) => { calls.dock.push(mode); }, onError: async () => {},
    ...overrides,
  });
  return { controller, trays, image, state, calls };
}

test("native tray exposes alias-only safe profile switching", async () => {
  const f = fixture();
  await f.controller.start();
  const tray = f.trays[0];
  assert.equal(f.image.template, true);
  assert.equal(tray.tooltip, "Claude Switcher — Personal");
  assert.equal(JSON.stringify(tray.menu).includes("example.com"), false);
  const switchMenu = tray.menu.find((item) => item.label === "Switch profile");
  const work = switchMenu.submenu.find((item) => item.label === "Work");
  work.click();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(f.calls.activated, ["work-id"]);
  tray.menu.find((item) => item.label === "Open Claude Switcher").click();
  assert.equal(f.calls.shown, 1);
});

test("tray blocks account switching when recovery requires attention", async () => {
  const f = fixture();
  f.state.recovery.status = "recovery-required";
  await f.controller.start();
  const switchMenu = f.trays[0].menu.find((item) => item.label === "Switch profile");
  assert.equal(switchMenu.submenu.find((item) => item.label === "Work").enabled, false);
});

test("numbered privacy mode hides aliases and keeps activation bound to stable profile ids", async () => {
  const f = fixture();
  f.state.preferences.trayDisplayMode = "numbered";
  await f.controller.start();
  const tray = f.trays[0];
  const serialized = JSON.stringify(tray.menu);
  assert.equal(serialized.includes("Personal"), false);
  assert.equal(serialized.includes("Work"), false);
  assert.equal(serialized.includes("example.com"), false);
  assert.equal(tray.tooltip, "Claude Switcher");
  assert.equal(tray.menu[0].label, "Active: Profile 1");
  const profiles = tray.menu.find((item) => item.label === "Switch profile").submenu;
  assert.deepEqual(profiles.map((item) => item.label), ["Profile 1", "Profile 2"]);
  profiles[1].click();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(f.calls.activated, ["work-id"]);
});

test("macOS tray can restore the Dock entry point", async () => {
  const f = fixture();
  await f.controller.start();
  const dock = f.trays[0].menu.find((item) => item.label === "Show in Dock");
  dock.click({ checked: false });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(f.calls.dock, ["menu-bar-only"]);
});

test("empty native image never becomes an available tray escape path", async () => {
  const emptyImage = { isEmpty: () => true, resize() { return this; }, setTemplateImage() {} };
  const f = fixture({ nativeImage: { createFromPath: () => emptyImage } });
  await assert.rejects(() => f.controller.start(), (error) => error.code === "TRAY_ICON_UNAVAILABLE");
  assert.equal(f.controller.available(), false);
  assert.equal(f.trays.length, 0);
});

test("an image that becomes empty during resize also fails closed", async () => {
  const emptyImage = { isEmpty: () => true, setTemplateImage() {} };
  const sourceImage = { isEmpty: () => false, resize: () => emptyImage };
  const f = fixture({ nativeImage: { createFromPath: () => sourceImage } });
  await assert.rejects(() => f.controller.start(), (error) => error.code === "TRAY_ICON_UNAVAILABLE");
  assert.equal(f.controller.available(), false);
  assert.equal(f.trays.length, 0);
});
