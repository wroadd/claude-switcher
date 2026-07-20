const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("claudeSwitcher", Object.freeze({
  getState: () => ipcRenderer.invoke("state:get", {}),
  captureCurrent: (alias) => ipcRenderer.invoke("account:capture", { alias }),
  activate: (id) => ipcRenderer.invoke("account:activate", { id }),
  rename: (id, alias) => ipcRenderer.invoke("account:rename", { id, alias }),
  remove: (id) => ipcRenderer.invoke("account:remove", { id }),
  restore: (id) => ipcRenderer.invoke("recovery:restore", { id }),
  exportDiagnostics: () => ipcRenderer.invoke("diagnostics:export", {}),
  retryRecovery: () => ipcRenderer.invoke("recovery:retry", {}),
  setRecoveryRetention: (value) => ipcRenderer.invoke("settings:recovery-retention", { value }),
  setCloseBehavior: (value) => ipcRenderer.invoke("settings:close-behavior", { value }),
  setDockMode: (value) => ipcRenderer.invoke("settings:dock-mode", { value }),
  setTrayDisplayMode: (value) => ipcRenderer.invoke("settings:tray-display-mode", { value }),
  openLogin: () => ipcRenderer.invoke("auth:login", {}),
}));
