import { useEffect, useMemo, useState } from "react";
import { Activity as ActivityIcon, Check, ChevronRight, Clock3, KeyRound, LockKeyhole, Pencil, Play, Plus, RefreshCw, Settings, Terminal, Trash2, UserRound, UsersRound, X } from "lucide-react";
import type { Account, AppState, ClaudeSwitcherApi } from "./types";
import { demoApi } from "./demoApi";

const emptyState: AppState = {
  accounts: [], activity: [],
  claude: { installed: false, version: null, loggedIn: false, email: null },
  security: { encryptionAvailable: false, platform: "unknown", storageBackend: null, reason: null, remediation: null },
  recovery: { status: "clear" },
  store: { mode: "ready", version: 2, revision: 0, reason: null },
  recoveries: [],
  preferences: { recoveryRetention: 20, closeBehavior: "hide", dockMode: "dock-and-menu-bar" },
};

const unavailableApi = new Proxy({}, { get: () => async () => { throw new Error("The native security bridge is unavailable. No account operation was performed."); } }) as ClaudeSwitcherApi;
const api = window.claudeSwitcher ?? (import.meta.env.DEV ? demoApi : unavailableApi);

function Logo() {
  return <div className="logo" aria-label="Claude Switcher"><span className="logo-mark"><span /></span><strong>Claude Switcher</strong></div>;
}

function maskedEmail(value: string | null) {
  if (!value) return "Identity unavailable";
  if (value.includes("•")) return value;
  const [name, domain] = value.split("@");
  if (!domain) return value;
  return `${name.slice(0, 2)}${"•".repeat(Math.max(4, Math.min(8, name.length - 2)))}@${domain}`;
}

function relativeTime(value: string | null) {
  if (!value) return "Never";
  const seconds = Math.max(0, Math.floor((Date.now() - Date.parse(value)) / 1000));
  if (seconds < 60) return "Just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

function AccountRow({ account, onActivate, onRename, onRemove, busy }: {
  account: Account; onActivate(): void; onRename(): void; onRemove(): void; busy: boolean;
}) {
  return <div className={`account-row ${account.active ? "is-active" : ""}`}>
    <div className="identity"><span className="avatar"><UserRound size={17} /></span><div><strong>{account.alias}</strong><span>{maskedEmail(account.email)}</span></div></div>
    <span className="type">{account.subscriptionType ? `Claude ${account.subscriptionType}` : account.authMethod}</span>
    <span className={`status ${account.active ? "active" : ""}`}><i />{account.active ? "Active" : "Inactive"}</span>
    <span className="last-used">{relativeTime(account.lastUsedAt)}</span>
    <div className="row-actions">
      <button className="icon-button" onClick={onActivate} disabled={busy || account.active} title={account.active ? "Active account" : "Activate account"}>{account.active ? <Check size={16} /> : <Play size={16} />}</button>
      <button className="icon-button" onClick={onRename} disabled={busy} title="Rename account"><Pencil size={15} /></button>
      <button className="icon-button danger" onClick={onRemove} disabled={busy || account.active} title={account.active ? "Activate another account before removing" : "Remove account"}><Trash2 size={15} /></button>
    </div>
  </div>;
}

function AddAccount({ onClose, onCapture, onOpenLogin, busy, loggedIn }: {
  onClose(): void; onCapture(alias: string): void; onOpenLogin(): void; busy: boolean; loggedIn: boolean;
}) {
  const [alias, setAlias] = useState("");
  return <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
    <section className="dialog" role="dialog" aria-modal="true" aria-labelledby="add-title">
      <header><h2 id="add-title">Add account</h2><button className="plain-icon" onClick={onClose} aria-label="Close"><X /></button></header>
      <div className="dialog-body">
        <label className="field"><span>Account alias</span><input autoFocus value={alias} onChange={(e) => setAlias(e.target.value)} placeholder="e.g. personal or work" maxLength={40} /></label>
        <button className="choice" disabled={!loggedIn || !alias.trim() || busy} onClick={() => onCapture(alias.trim())}>
          <span className="choice-icon"><LockKeyhole /></span><span><strong>Capture current Claude login</strong><small>{loggedIn ? "Encrypt and save the account currently used by Claude Code." : "Sign in to Claude Code first."}</small></span><ChevronRight />
        </button>
        <button className="choice" disabled={busy} onClick={onOpenLogin}>
          <span className="choice-icon"><Terminal /></span><span><strong>Open Claude login</strong><small>Launch a terminal and run the official Claude authentication flow.</small></span><ChevronRight />
        </button>
        <div className="api-note"><KeyRound size={17} /><span><strong>API key profiles</strong> are intentionally deferred until they can be activated without writing plaintext keys to shell configuration.</span></div>
      </div>
      <footer><button className="secondary" onClick={onClose}>Cancel</button></footer>
    </section>
  </div>;
}

function SettingsView({ state, busy, blocked, onExport, onRestore, onRetention, onCloseBehavior, onDockMode }: {
  state: AppState; busy: boolean; blocked: boolean;
  onExport(): void; onRestore(id: string): void; onRetention(value: number): void;
  onCloseBehavior(value: "hide" | "quit"): void; onDockMode(value: "dock-and-menu-bar" | "menu-bar-only"): void;
}) {
  return <>
    <div className="page-heading">
      <div><h1>Settings</h1><p>Security and runtime information for this installation.</p></div>
      <button className="secondary" disabled={busy} onClick={onExport}>Export diagnostics</button>
    </div>
    <section className="settings-page">
      <div><span>Credential encryption</span><strong>{state.security.encryptionAvailable ? "Available" : "Unavailable"}</strong></div>
      <div><span>Storage backend</span><strong>{state.security.storageBackend ?? "Operating system default"}</strong></div>
      <div><span>Platform</span><strong>{state.security.platform}</strong></div>
      <div><span>Store schema</span><strong>{state.store.version ? `v${state.store.version}, revision ${state.store.revision}` : state.store.mode}</strong></div>
      <div><span>Claude CLI</span><strong>{state.claude.version ?? "Not detected"}</strong></div>
      <div><label htmlFor="recovery-retention">Recovery retention</label><select id="recovery-retention" disabled={busy || blocked} value={state.preferences.recoveryRetention} onChange={(event) => onRetention(Number(event.target.value))}>{[5, 10, 20, 50, 100].map((value) => <option key={value} value={value}>{value} points</option>)}</select></div>
      <div><label htmlFor="close-behavior">Closing the window</label><select id="close-behavior" disabled={busy || blocked} value={state.preferences.closeBehavior} onChange={(event) => onCloseBehavior(event.target.value as "hide" | "quit")}><option value="hide">Keep running in the menu bar</option><option value="quit">Quit Claude Switcher</option></select></div>
      {state.security.platform === "darwin" && <div><label htmlFor="dock-mode">macOS presence</label><select id="dock-mode" disabled={busy || blocked} value={state.preferences.dockMode} onChange={(event) => onDockMode(event.target.value as "dock-and-menu-bar" | "menu-bar-only")}><option value="dock-and-menu-bar">Dock and menu bar</option><option value="menu-bar-only">Menu bar only</option></select></div>}
      {state.security.remediation && <p>{state.security.remediation}</p>}
      <p>Claude Switcher stores encrypted credential snapshots and recovery records in Electron's OS-backed secure storage. Activation is verified and automatically rolled back on failure.</p>
    </section>
    <section className="recent">
      <h2>Recovery points</h2>
      {state.recoveries.length ? state.recoveries.slice(0, 10).map((item) => <div className="activity-row" key={item.id}>
        <LockKeyhole /><span><strong>{item.createdAt ? new Date(item.createdAt).toLocaleString() : "Invalid recovery"}</strong> {item.status} · {item.integrity}</span>
        <button className="secondary" disabled={busy || blocked || !state.security.encryptionAvailable || item.integrity !== "valid"} onClick={() => onRestore(item.id)}>Restore</button>
      </div>) : <div className="activity-empty"><LockKeyhole /><span><strong>No recovery points</strong>They are created before account activation.</span></div>}
    </section>
  </>;
}

export default function App() {
  const [state, setState] = useState<AppState>(emptyState);
  const [tab, setTab] = useState<"accounts" | "activity" | "settings">("accounts");
  const [addOpen, setAddOpen] = useState(false);
  const [busy, setBusy] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);

  const active = useMemo(() => state.accounts.find((account) => account.active), [state.accounts]);
  const mutationsBlocked = state.recovery.status === "recovery-required" || state.store.mode !== "ready";
  const run = async (action: () => Promise<AppState>, success: string) => {
    setBusy(true); setNotice(null);
    try { setState(await action()); setNotice(success); }
    catch (error) { setNotice(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  };

  useEffect(() => {
    api.getState().then(setState).catch((error) => setNotice(String(error))).finally(() => setBusy(false));
  }, []);

  const capture = (alias: string) => run(() => api.captureCurrent(alias), "Account encrypted and saved.").then(() => setAddOpen(false));
  const activate = (account: Account) => run(() => api.activate(account.id), `${account.alias} is now active.`);
  const rename = (account: Account) => {
    const alias = window.prompt("New account alias", account.alias)?.trim();
    if (alias && alias !== account.alias) void run(() => api.rename(account.id, alias), "Account renamed.");
  };
  const remove = (account: Account) => {
    if (window.confirm(`Remove the encrypted profile “${account.alias}”?`)) void run(() => api.remove(account.id), "Stored profile removed.");
  };
  const openLogin = async () => {
    setBusy(true);
    try { const result = await api.openLogin(); setNotice(result.message); }
    catch (error) { setNotice(String(error)); }
    finally { setBusy(false); }
  };
  const exportDiagnostics = async () => {
    setBusy(true); setNotice(null);
    try { setNotice((await api.exportDiagnostics()).message); }
    catch (error) { setNotice(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  };
  const restoreRecovery = (id: string) => {
    if (window.confirm("Restore this recovery point? The current state will be backed up first.")) void run(() => api.restore(id), "Recovery point restored.");
  };
  const setRecoveryRetention = (value: number) => { void run(() => api.setRecoveryRetention(value), "Recovery retention updated."); };
  const setCloseBehavior = (value: "hide" | "quit") => { void run(() => api.setCloseBehavior(value), "Window behavior updated."); };
  const setDockMode = (value: "dock-and-menu-bar" | "menu-bar-only") => { void run(() => api.setDockMode(value), "macOS presence updated."); };

  return <main className="app-shell">
    <header className="titlebar"><Logo /><span className="titlebar-note">Local account manager</span></header>
    <aside className="sidebar">
      <nav>
        <button className={tab === "accounts" ? "selected" : ""} onClick={() => setTab("accounts")}><UsersRound />Accounts</button>
        <button className={tab === "activity" ? "selected" : ""} onClick={() => setTab("activity")}><ActivityIcon />Activity</button>
        <button className={tab === "settings" ? "selected" : ""} onClick={() => setTab("settings")}><Settings />Settings</button>
      </nav>
      <div className="privacy"><LockKeyhole /><span>Your credentials stay<br />on this device.</span></div>
    </aside>
    <section className="content">
      {state.recovery.status === "recovery-required" && <div className="notice" role="alert"><span>Account changes are blocked because activation recovery requires attention. Recovery ID: {state.recovery.recoveryId ?? "unknown"}</span><button disabled={busy || !state.security.encryptionAvailable} onClick={() => void run(() => api.retryRecovery(), "Recovery retried.")}>Retry recovery</button></div>}
      {state.store.mode !== "ready" && <div className="notice" role="alert">Profile storage is {state.store.mode}. Account changes are blocked to preserve existing data.</div>}
      {notice && <div className="notice" role="status">{notice}<button onClick={() => setNotice(null)}><X size={15} /></button></div>}
      {tab === "accounts" && <>
        <div className="page-heading"><div><h1>Accounts</h1><p>Securely switch the Claude Code identity used on this device.</p></div><button className="primary" onClick={() => setAddOpen(true)} disabled={busy || mutationsBlocked || !state.security.encryptionAvailable}><Plus />Add account</button></div>
        <section className="summary">
          <div><span className="summary-icon orange"><UserRound /></span><span><small>Active account</small><strong>{active?.alias ?? "Not captured"}</strong><em>{maskedEmail(active?.email ?? state.claude.email)}</em></span></div>
          <div><span className={`summary-icon ${state.claude.installed ? "green" : "gray"}`}>{state.claude.installed ? <Check /> : <X />}</span><span><small>Claude CLI {state.claude.installed ? "detected" : "not found"}</small><strong>{state.claude.installed ? "Connected" : "Unavailable"}</strong><em>{state.claude.version ?? "Install Claude Code to continue"}</em></span></div>
          <button className="refresh" onClick={() => run(() => api.getState(), "Status refreshed.")} disabled={busy} title="Refresh status"><RefreshCw className={busy ? "spin" : ""} /></button>
        </section>
        <section className="accounts-list" aria-label="Saved accounts">
          <div className="list-head"><span>Account</span><span>Type</span><span>Status</span><span>Last used</span><span>Actions</span></div>
          {state.accounts.length ? state.accounts.map((account) => <AccountRow key={account.id} account={account} busy={busy || mutationsBlocked || !state.security.encryptionAvailable} onActivate={() => activate(account)} onRename={() => rename(account)} onRemove={() => remove(account)} />) : <div className="empty"><UsersRound /><strong>No saved accounts yet</strong><span>Sign in with Claude Code, then capture the current login.</span><button className="secondary" disabled={mutationsBlocked || !state.security.encryptionAvailable} onClick={() => setAddOpen(true)}>Add your first account</button></div>}
        </section>
        <section className="recent"><h2>Recent activity</h2>{state.activity.length ? state.activity.slice(0, 4).map((item) => <div className="activity-row" key={item.id}><Clock3 /><span><strong>{item.alias}</strong> {item.type}</span><time>{relativeTime(item.at)}</time></div>) : <div className="activity-empty"><Clock3 /><span><strong>No recent activity</strong>Account switches will appear here.</span></div>}</section>
      </>}
      {tab === "activity" && <><div className="page-heading"><div><h1>Activity</h1><p>A local audit trail of account profile actions.</p></div></div><section className="activity-page">{state.activity.length ? state.activity.map((item) => <div className="activity-row" key={item.id}><Clock3 /><span><strong>{item.alias}</strong> {item.type}</span><time>{new Date(item.at).toLocaleString()}</time></div>) : <div className="empty"><ActivityIcon /><strong>No activity recorded</strong><span>Your profile actions will be recorded locally.</span></div>}</section></>}
      {tab === "settings" && <SettingsView state={state} busy={busy} blocked={mutationsBlocked} onExport={exportDiagnostics} onRestore={restoreRecovery} onRetention={setRecoveryRetention} onCloseBehavior={setCloseBehavior} onDockMode={setDockMode} />}
    </section>
    {addOpen && <AddAccount onClose={() => setAddOpen(false)} onCapture={capture} onOpenLogin={openLogin} busy={busy || mutationsBlocked} loggedIn={state.claude.loggedIn} />}
  </main>;
}
