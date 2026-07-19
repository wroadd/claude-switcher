# Architecture

## Overview

Claude Switcher has three trust zones:

1. **React renderer** — displays non-secret account metadata and invokes a small typed API.
2. **Preload bridge** — exposes only explicit account and authentication operations through Electron IPC.
3. **Main process** — reads Claude CLI status, accesses credential storage, encrypts snapshots, creates backups, and applies account changes.

Node integration is disabled in the renderer, context isolation is enabled, and the renderer is sandboxed.

## Data model

Electron's application data directory contains:

- `profiles.json` — aliases, masked identity metadata, active state, and local activity history;
- `vault.json` — base64-encoded ciphertext produced by Electron `safeStorage`;
- `backups/<timestamp>/` — pre-switch copies of Claude configuration files when present.

The vault contains opaque Claude credential JSON plus the account-specific `oauthAccount` and `userID` fields needed to keep Claude Code identity metadata aligned.

## Capture flow

1. Run `claude auth status --json` and require an authenticated identity.
2. Read the active credential material from macOS Keychain or Claude's credentials file.
3. Extract only account metadata from `.claude.json`.
4. Encrypt the bundle with the operating system's secure-storage facility.
5. Write the encrypted vault before publishing metadata.

## Activation flow

1. Refuse the operation when a `claude` process is running.
2. Decrypt the selected profile in memory.
3. Back up existing file-based Claude configuration.
4. Replace the credential entry or file.
5. Merge account metadata into `.claude.json` without replacing unrelated settings.
6. Mark the profile active and append an audit event.

## Platform behavior

- **macOS:** OAuth credentials are read from and written to the `Claude Code-credentials` generic-password item in Keychain when available.
- **Linux and Windows:** the MVP supports Claude's `.credentials.json` file layout. The encrypted profile vault remains protected by the platform implementation behind Electron `safeStorage`.

Platform behavior can change with Claude Code releases. Compatibility is therefore verified through the public `claude auth status --json` command, and raw credentials are treated as opaque JSON.
