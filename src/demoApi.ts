import type { AppState, ClaudeSwitcherApi } from "./types";

let demoState: AppState = {
  accounts: [
    { id: "demo-personal", alias: "personal", email: "alex@example.com", authMethod: "claude.ai", subscriptionType: "max", active: true, createdAt: new Date(Date.now() - 2592000000).toISOString(), lastUsedAt: new Date(Date.now() - 120000).toISOString() },
    { id: "demo-work", alias: "work", email: "alex@company.com", authMethod: "claude.ai", subscriptionType: "team", active: false, createdAt: new Date(Date.now() - 1209600000).toISOString(), lastUsedAt: new Date(Date.now() - 10800000).toISOString() },
  ],
  activity: [
    { id: "activity-1", accountId: "demo-personal", alias: "personal", type: "activated", at: new Date(Date.now() - 120000).toISOString() },
    { id: "activity-2", accountId: "demo-work", alias: "work", type: "captured", at: new Date(Date.now() - 10800000).toISOString() },
  ],
  claude: { installed: true, version: "2.1.47 (Claude Code)", loggedIn: true, email: "alex@example.com" },
  security: { encryptionAvailable: true, platform: "browser preview", storageBackend: null, reason: null, remediation: null },
  recovery: { status: "clear" },
  store: { mode: "ready", version: 2, revision: 0, reason: null },
  recoveries: [],
  preferences: { recoveryRetention: 20, closeBehavior: "hide", dockMode: "dock-and-menu-bar", trayDisplayMode: "aliases" },
};

const clone = () => structuredClone(demoState);

export const demoApi: ClaudeSwitcherApi = {
  async getState() { return clone(); },
  async captureCurrent(alias) {
    const now = new Date().toISOString();
    demoState.accounts.forEach((account) => { account.active = false; });
    demoState.accounts.push({ id: `demo-${Date.now()}`, alias, email: "preview@example.com", authMethod: "claude.ai", subscriptionType: "max", active: true, createdAt: now, lastUsedAt: now });
    return clone();
  },
  async activate(id) {
    demoState.accounts.forEach((account) => { account.active = account.id === id; });
    return clone();
  },
  async rename(id, alias) {
    const account = demoState.accounts.find((item) => item.id === id);
    if (account) account.alias = alias;
    return clone();
  },
  async remove(id) {
    demoState.accounts = demoState.accounts.filter((account) => account.id !== id);
    return clone();
  },
  async restore() { return clone(); },
  async exportDiagnostics() { return { ok: false, message: "Diagnostics export is unavailable in browser preview mode." }; },
  async retryRecovery() { return clone(); },
  async setRecoveryRetention(value) { demoState.preferences.recoveryRetention = value; return clone(); },
  async setCloseBehavior(value) { demoState.preferences.closeBehavior = value; return clone(); },
  async setDockMode(value) { demoState.preferences.dockMode = value; return clone(); },
  async setTrayDisplayMode(value) { demoState.preferences.trayDisplayMode = value; return clone(); },
  async openLogin() { return { ok: true, message: "Login launch is disabled in browser preview mode." }; },
};
