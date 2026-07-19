# Architecture

## Overview

Claude Switcher has three trust zones:

1. **React renderer** — displays non-secret account metadata and invokes a small typed API.
2. **Preload bridge** — exposes only explicit account and authentication operations through Electron IPC.
3. **Main process** — reads Claude CLI status, accesses credential storage, encrypts snapshots, creates backups, and applies account changes.

Node integration is disabled in the renderer, context isolation is enabled, and the renderer is sandboxed.

## Data model

Electron's application data directory contains:

- `store.json` — schema-v2, revisioned account metadata, activity, and `safeStorage` ciphertext entries in one atomic document;
- `activation-journal.json` — non-secret transaction ID, target/previous profile IDs, adapter, and phase while activation is in progress;
- `backups/<recovery-id>/manifest.json` — metadata-only recovery lifecycle and ciphertext integrity hash;
- `backups/<recovery-id>/recovery.json` — the complete previous credential/root-config state encrypted with `safeStorage`.

Version-1 `profiles.json` and `vault.json` are migrated into the consolidated store while preserving profile IDs and ciphertext bytes. Invalid current stores are quarantined and future versions remain untouched/read-only. Full emails are replaced in metadata by a masked display value and a store-salted fingerprint; the encrypted bundle retains the identity needed for verification.

## Capture flow

1. Run `claude auth status --json` and require an authenticated identity.
2. Read the active credential material from macOS Keychain or Claude's credentials file.
3. Extract only account metadata from `.claude.json`.
4. Encrypt the bundle with the operating system's secure-storage facility.
5. Commit the consolidated store atomically with a shared revision.

## Activation flow

1. Require a `clear` process probe; `blocked` and `unknown` both stop activation.
2. Decrypt and validate the selected profile, capture the authoritative current credential adapter and exact recoverable state.
3. Persist an encrypted recovery record and non-secret `prepared` journal before mutation.
4. Recheck that official auth state did not change during preflight.
5. Apply credentials without deleting the existing Keychain item first and merge only account metadata into `.claude.json`.
6. Verify the intended identity through `claude auth status --json`.
7. Commit active-profile metadata last, mark recovery committed, and remove the journal.
8. On failure, restore exact prior file bytes/permissions or Keychain value, verify the previous identity, and record rollback. Unverifiable rollback retains the journal and blocks mutations.

Manual restore uses the same coordinator. It first creates a recovery point for the current state, validates/decrypts the selected historical record, requires a matching saved profile, applies and verifies it, then commits the matching active metadata.

Terminal recovery records use a configurable 5–100 point retention policy (default 20). Only older integrity-valid `committed` or `rolled-back` directories are eligible; unresolved, rollback-failed, and invalid records are retained for explicit recovery/investigation.

## Diagnostics boundary

The renderer can request an export but cannot provide a filesystem path. The main process opens a native save dialog and passes an allowlisted metadata projection to the diagnostics module. Profile IDs, aliases, and any internal paths are HMAC-pseudonymized; full emails, credentials, vault/recovery content, raw command output, and unknown error text are structurally excluded. A final content scan and size limit run before an atomic permission-restricted write. No network sharing occurs.

## Platform behavior

- **macOS:** OAuth credentials are read from and written to the `Claude Code-credentials` generic-password item in Keychain when available.
- **Linux:** `.credentials.json` is supported only when Electron selects `gnome_libsecret`, `kwallet`, `kwallet5`, or `kwallet6`; `basic_text` and `unknown` are rejected.
- **Windows:** the current adapter supports Claude's `.credentials.json` layout; real supported-build verification remains a human compatibility gate.

Platform behavior can change with Claude Code releases. Compatibility is therefore verified through the public `claude auth status --json` command, and raw credentials are treated as opaque JSON.
