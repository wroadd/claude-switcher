const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("claudeSwitcher", Object.freeze({
  getState: () => ipcRenderer.invoke("state:get", {}),
  captureCurrent: (alias) => ipcRenderer.invoke("account:capture", { alias }),
  activate: (id) => ipcRenderer.invoke("account:activate", { id }),
  rename: (id, alias) => ipcRenderer.invoke("account:rename", { id, alias }),
  remove: (id) => ipcRenderer.invoke("account:remove", { id }),
  openLogin: () => ipcRenderer.invoke("auth:login", {}),
}));
