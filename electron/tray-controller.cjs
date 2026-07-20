function createTrayController({ Tray, Menu, nativeImage, iconPath, platform, getState, activate, showWindow, quit, setDockMode, onError }) {
  let tray = null;
  let switching = false;

  function available() { return tray !== null; }

  async function switchProfile(id) {
    if (switching) return;
    switching = true;
    await refresh();
    try {
      await activate(id);
    } catch (error) {
      await onError(error);
    } finally {
      switching = false;
      await refresh();
    }
  }

  async function updateDockMode(mode) {
    try {
      await setDockMode(mode);
    } catch (error) {
      await onError(error);
    } finally {
      await refresh();
    }
  }

  async function refresh() {
    if (!tray) return;
    const state = await getState();
    const active = state.accounts.find((account) => account.active);
    const blocked = switching || state.store.mode !== "ready" || state.recovery.status === "recovery-required" || !state.security.encryptionAvailable;
    const profiles = state.accounts.length
      ? state.accounts.map((account) => ({
          label: account.alias,
          type: "radio",
          checked: account.active,
          enabled: !blocked && !account.active,
          click: () => void switchProfile(account.id),
        }))
      : [{ label: "No saved profiles", enabled: false }];
    const template = [
      { label: active ? `Active: ${active.alias}` : "No active profile", enabled: false },
      { type: "separator" },
      ...profiles,
      { type: "separator" },
      { label: "Open Claude Switcher", click: showWindow },
    ];
    if (platform === "darwin") {
      template.push({
        label: "Show in Dock",
        type: "checkbox",
        checked: state.preferences.dockMode === "dock-and-menu-bar",
        click: (item) => void updateDockMode(item.checked ? "dock-and-menu-bar" : "menu-bar-only"),
      });
    }
    template.push({ type: "separator" }, { label: "Quit Claude Switcher", click: quit });
    tray.setToolTip(active ? `Claude Switcher — ${active.alias}` : "Claude Switcher");
    tray.setContextMenu(Menu.buildFromTemplate(template));
  }

  async function start() {
    if (tray) return true;
    const sourceImage = nativeImage.createFromPath(iconPath);
    if (sourceImage.isEmpty()) {
      const error = new Error("The native tray icon could not be loaded.");
      error.code = "TRAY_ICON_UNAVAILABLE";
      throw error;
    }
    const image = sourceImage.resize({ width: 18, height: 18 });
    if (image.isEmpty()) {
      const error = new Error("The native tray icon could not be resized safely.");
      error.code = "TRAY_ICON_UNAVAILABLE";
      throw error;
    }
    if (platform === "darwin") image.setTemplateImage(true);
    tray = new Tray(image);
    if (platform !== "darwin") tray.on("click", showWindow);
    await refresh();
    return true;
  }

  function dispose() {
    if (tray) tray.destroy();
    tray = null;
  }

  return { available, start, refresh, dispose };
}

module.exports = { createTrayController };
