# Recovery runbook

## Normal behavior

Before any account activation or manual restore, Claude Switcher captures the current authoritative credential adapter and root configuration, encrypts the complete snapshot with Electron `safeStorage`, writes an integrity-checked recovery manifest, and records a non-secret journal. Profile metadata is committed only after the official CLI reports the intended identity.

If apply or verification fails, the previous state is restored automatically. The activity log records only the transaction/recovery IDs and a stable error code.

## Recovery-required state

If automatic rollback or its identity verification cannot be completed, the application:

1. retains the encrypted recovery record and journal;
2. blocks capture, activation, rename, remove, and restore operations;
3. shows the recovery identifier without exposing identity or credentials;
4. retries safe journal recovery on the next application start only when the Claude process probe is clear.

Do not delete the recovery directory or edit Claude configuration while collecting evidence. Close Claude Code, restart Claude Switcher once, and record the recovery ID. If the state remains blocked, use the official `claude auth login` flow and report the issue through the private security channel when credential loss/exposure may be involved.

## Manual restore

Settings lists metadata-only recovery points and their integrity state. A valid recovery can be restored explicitly. Claude Switcher first creates a new encrypted snapshot of the current state, applies the selected recovery, verifies its identity, and activates the matching saved profile. Invalid records and recoveries whose profile was removed cannot be restored automatically.

Recovery retention is configurable from 5 to 100 points (default 20). Pruning considers only integrity-valid terminal `committed` or `rolled-back` records, keeps the newest configured count, and never automatically deletes unresolved, rollback-failed, or invalid records.

## Redacted diagnostics

**Export diagnostics** opens a native save dialog. The generated JSON contains bounded application/runtime metadata, pseudonymous profile/event references, stable error codes, and capability flags. Credentials, vault/backups, raw command output, full emails, aliases, usernames, and absolute paths are structurally excluded; a canary/safety scan refuses unsafe output. Sharing remains a separate user action.

## Legacy v0.1 backups

Version 0.1 could create plaintext file backups protected only by filesystem permissions. Version 0.2 does not import or trust them as recovery records. Users upgrading from v0.1 should identify and remove legacy backup directories only after the new version has completed a verified activation and a valid encrypted recovery record is visible. Automatic deletion is intentionally avoided.

## Release drill

Use tester-owned accounts only. For each supported adapter:

- verify successful switch and matching `claude auth status --json` identity;
- inject/induce a denied write after credential replacement and prove the old identity returns;
- interrupt at prepared, applied, verified, and metadata-committed phases and restart;
- verify a valid recovery through Settings and confirm a new safety recovery is created;
- lock/deny the credential service and confirm changes fail closed;
- confirm no credential canary appears in application data outside OS-encrypted ciphertext, UI, errors, diagnostics, test output, or build artifacts.

The exact macOS Keychain, Windows, GNOME Keyring/libsecret, and KWallet drills are human release gates because hosted CI cannot reproduce their prompts, ACLs, desktop sessions, and authoritative Claude Code storage behavior.
