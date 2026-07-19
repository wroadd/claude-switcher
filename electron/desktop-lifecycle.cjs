const CLOSE_BEHAVIORS = new Set(["hide", "quit"]);
const DOCK_MODES = new Set(["dock-and-menu-bar", "menu-bar-only"]);

function shouldHideWindowOnClose({ isQuitting, closeBehavior, trayAvailable }) {
  return !isQuitting && closeBehavior === "hide" && trayAvailable;
}

async function applyDockMode({ platform, dock, dockMode, trayAvailable }) {
  if (platform !== "darwin" || !dock) return;
  const hideDock = dockMode === "menu-bar-only" && trayAvailable;
  if (hideDock && dock.isVisible()) await dock.hide();
  if (!hideDock && !dock.isVisible()) await dock.show();
}

module.exports = { CLOSE_BEHAVIORS, DOCK_MODES, shouldHideWindowOnClose, applyDockMode };
