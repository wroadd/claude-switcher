const { parseRequest } = require("./ipc-contracts.cjs");
const { authorizeSender } = require("./window-policy.cjs");

function registerAuthorizedHandler({ ipcMain, channel, getWindow, operation, mapError = (error) => error }) {
  ipcMain.handle(channel, async (event, request) => {
    try {
      authorizeSender(event, getWindow());
      const parsed = parseRequest(channel, request);
      return await operation(parsed);
    } catch (error) {
      throw mapError(error);
    }
  });
}

module.exports = { registerAuthorizedHandler };
