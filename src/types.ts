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
  type: "captured" | "activated" | "renamed" | "removed";
  at: string;
};

export type AppState = {
  accounts: Account[];
  activity: Activity[];
  claude: { installed: boolean; version: string | null; loggedIn: boolean; email: string | null };
  security: { encryptionAvailable: boolean; platform: string };
};

export type ClaudeSwitcherApi = {
  getState(): Promise<AppState>;
  captureCurrent(alias: string): Promise<AppState>;
  activate(id: string): Promise<AppState>;
  rename(id: string, alias: string): Promise<AppState>;
  remove(id: string): Promise<AppState>;
  openLogin(): Promise<{ ok: boolean; message: string }>;
};
