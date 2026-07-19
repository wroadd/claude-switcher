export type Account = {
  id: string;
  alias: string;
  email: string | null;
  authMethod: string;
  subscriptionType: string | null;
  active: boolean;
  createdAt: string;
  lastUsedAt: string | null;
};

export type Activity = {
  id: string;
  accountId: string;
  alias: string;
  type: "captured" | "activated" | "renamed" | "removed" | "activation-rolled-back" | "activation-recovery-required";
  at: string;
  details?: { transactionId?: string; recoveryId?: string; code?: string } | null;
};

export type AppState = {
  accounts: Account[];
  activity: Activity[];
  claude: { installed: boolean; version: string | null; loggedIn: boolean; email: string | null };
  security: { encryptionAvailable: boolean; platform: string; storageBackend: string | null; reason: string | null; remediation: string | null };
  recovery: { status: "clear" | "recovered" | "recovery-required"; recoveryId?: string; reason?: string };
  store: { mode: "ready" | "read-only" | "recovery-required"; version: number | null; revision: number; reason: string | null; quarantine?: string };
  recoveries: Array<{ id: string; createdAt: string | null; updatedAt: string | null; status: string; adapter: string | null; targetProfileId: string | null; integrity: "valid" | "invalid" }>;
};

export type ClaudeSwitcherApi = {
  getState(): Promise<AppState>;
  captureCurrent(alias: string): Promise<AppState>;
  activate(id: string): Promise<AppState>;
  rename(id: string, alias: string): Promise<AppState>;
  remove(id: string): Promise<AppState>;
  restore(id: string): Promise<AppState>;
  exportDiagnostics(): Promise<{ ok: boolean; message: string }>;
  retryRecovery(): Promise<AppState>;
  openLogin(): Promise<{ ok: boolean; message: string }>;
};
