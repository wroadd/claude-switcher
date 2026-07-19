const DEV_ORIGIN = "http://localhost:5173";

function rendererTarget({ isPackaged, devUrl }) {
  if (isPackaged || !devUrl) return { kind: "file" };
  let url;
  try { url = new URL(devUrl); } catch { throw new Error("Invalid development renderer URL."); }
  if (url.origin !== DEV_ORIGIN || url.pathname !== "/" || url.search || url.hash || url.username || url.password) {
    throw new Error("Development renderer URL must be exactly http://localhost:5173/.");
  }
  return { kind: "url", url: url.href };
}

function authorizeSender(event, window) {
  const contents = window?.webContents;
  if (!contents || contents.isDestroyed() || event.sender !== contents || event.senderFrame !== contents.mainFrame || event.senderFrame.url !== contents.getURL()) {
    const error = new Error("Unauthorized renderer request.");
    error.code = "UNAUTHORIZED_IPC";
    throw error;
  }
}

function configureWindowSecurity(contents, { packaged }) {
  contents.setWindowOpenHandler(() => ({ action: "deny" }));
  contents.on("will-navigate", (event) => event.preventDefault());
  contents.on("will-frame-navigate", (event) => event.preventDefault());
  contents.on("will-attach-webview", (event) => event.preventDefault());
  contents.session.setPermissionCheckHandler(() => false);
  contents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  if (packaged) {
    contents.session.webRequest.onHeadersReceived((details, callback) => callback({ responseHeaders: { ...details.responseHeaders, "Content-Security-Policy": ["default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"] } }));
  }
}

module.exports = { DEV_ORIGIN, authorizeSender, configureWindowSecurity, rendererTarget };
