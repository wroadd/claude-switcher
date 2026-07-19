# Codex Switcher feature parity map

## Scope and provenance

This inventory was produced from the user-owned [`wroadd/codex-switcher`](https://github.com/wroadd/codex-switcher) fork at commit `8c890d896598b464a135e4316260b7bb0df95541`. At audit time that commit matched `Lampese/codex-switcher` `main`.

The reference repository has no tracked `LICENSE` or `COPYING` file. Claude Switcher therefore uses it only to observe behavior and derive requirements. No source, assets, strings, protocol constants, undocumented payloads, or UI layout may be copied. Every accepted capability must be designed and implemented independently for Claude Code.

## Reference architecture map

The fork is a React/TypeScript frontend with a Rust/Tauri privileged backend. Its main trust and lifecycle surfaces are:

- a main account-management webview and a separate compact tray webview;
- Tauri commands for account, OAuth, usage/statistics, warm-up, process, window, Dock, and tray operations;
- a plaintext `~/.codex-switcher/accounts.json` account store and direct writes to the official Codex `auth.json`;
- OpenAI OAuth login/token-refresh and Codex/ChatGPT usage endpoints;
- cross-platform process discovery/termination and desktop-app launch helpers;
- native tray/application menus, close-to-background behavior, and a storage watcher;
- an optional HTTP server that serves the SPA and privileged command routes on the LAN;
- a Tauri updater and tag/manual cross-platform release workflow.

### Complete registered desktop command surface

The audited `src-tauri/src/lib.rs` registers these 32 commands:

1. `open_codex_app`
2. `list_accounts`
3. `get_active_account_info`
4. `add_account_from_file`
5. `switch_account`
6. `delete_account`
7. `rename_account`
8. `export_accounts_slim_text`
9. `import_accounts_slim_text`
10. `export_accounts_full_encrypted_file`
11. `import_accounts_full_encrypted_file`
12. `get_masked_account_ids`
13. `set_masked_account_ids`
14. `start_login`
15. `complete_login`
16. `cancel_login`
17. `get_usage`
18. `get_account_usage_stats`
19. `refresh_account_metadata`
20. `refresh_all_accounts_usage`
21. `warmup_account`
22. `warmup_all_accounts`
23. `check_codex_processes`
24. `kill_codex_processes`
25. `hide_tray_window`
26. `open_main_window`
27. `quit_app`
28. `report_usage`
29. `get_dock_display_mode`
30. `set_dock_display_mode`
31. `complete_close_behavior`
32. `ack_close_behavior_prompt`

The optional web router is a distinct command boundary. It adds browser-oriented `add_account_from_auth_json_text`, `export_accounts_full_encrypted_bytes`, and `import_accounts_full_encrypted_bytes`, while omitting native lifecycle operations. At the audited commit it binds to `0.0.0.0` without authentication, TLS, CSRF/origin enforcement, or adequate request limits; it is evidence for a non-goal, not an architecture to port.

## Capability map

| Reference capability | Reference status | Claude Switcher MVP | Decision | Target |
| --- | --- | --- | --- | --- |
| Multiple account capture and switching | Shipped | Shipped for official Claude Code OAuth captures | Keep; make transactional | v0.2 |
| Running-process guard | Shipped, cross-platform and Codex-specific | Basic probe, with false-negative/fail-open cases | Build Claude-specific fail-closed adapters | v0.2 |
| Force-close and retry | Shipped | Missing | Discovery; explicit opt-in only | Discovery |
| Rename/delete/active-state management | Shipped with active-state divergence edge cases | Basic operations shipped | Enforce store and official-state invariants | v0.2 |
| Backup and restore | No safe pre-write recovery in reference | File backup only; incomplete and plaintext for credentials | Encrypted complete recovery plus restore UI | v0.2 |
| Native tray switching | Shipped | Missing | Implement after the safe coordinator | v0.4 |
| Close-to-background and macOS Dock/menu-bar modes | Shipped | Missing | Implement with a visible escape-path invariant | v0.4 |
| Theme, sorting, masking | Shipped/partial; tray masking leaks | Minimal main-window presentation | Implement consistently and accessibly | v0.4 |
| Metadata refresh and re-auth guidance | Shipped with Codex-specific OAuth refresh | Basic current CLI status only | Use documented Claude CLI behavior only | v0.4 |
| Open companion desktop app | Partial | Missing | Constrained platform-specific launcher | v0.4 |
| Full encrypted export/import | Partial; embedded preset passphrase weakens protection | Missing | User-passphrase AEAD, dry run, validation, no auto-activation | v1.1 |
| Slim secret export/import | Shipped without encryption | Missing | Reject for secrets; allow credential-free metadata only | v1.1 |
| Local usage/activity statistics | Shipped using Codex/ChatGPT APIs | Basic local activity log | Local app activity only | v0.4 |
| Subscription quota/reset time/credits | Shipped using Codex-specific endpoints and claims | Missing | Block pending documented Claude contract | Discovery |
| Manual/automatic/timed warm-up | Shipped/partial | Missing | Block unattended activity; study explicit manual action only | Discovery |
| API-key accounts | Shipped | Deliberately excluded | Study process-scoped launcher; never persist plaintext | Discovery |
| Browser/LAN dashboard | Shipped with unauthenticated privileged routes | Missing | Reject pre-1.0; localhost read-only could be reconsidered | Post-1.0 |
| Auto-update | Shipped, but points to the original upstream release endpoint | Missing | Repository-owned signed channel only | v0.3 |
| Four-target release automation | Shipped on release events; no ordinary PR CI | Basic CI and packaging workflows | Add platform tests, signing, SBOM, provenance | v0.3 |
| Native menus | Shipped | Missing | Add with desktop workflow | v0.4 |

### Additional observed surfaces

- **OAuth lifecycle:** local callback login, cancellation, access-token refresh, and active official-auth synchronization. All constants and token behavior are OpenAI-specific.
- **Account metadata:** plan badge, subscription expiry, last-used time, masking, sorting, inline rename, and guarded delete.
- **Usage presentation:** 5-hour and weekly quota bars, reset countdown, reset credits, lifetime/daily/7-day/30-day statistics, charts, streaks, model/reasoning/skill/thread summaries, and tray title suffixes. The data providers are Codex/ChatGPT-specific.
- **Warm-up automation:** one/all manual calls, reset-aware auto mode, timed schedules, throttling, and renderer-local ledgers. It creates real model traffic and is not a portable switching primitive.
- **Desktop lifecycle:** rich tray popup on macOS/Windows, native tray fallback on Linux, native menus, custom window chrome, close-to-background, Dock visibility preferences, and an invariant intended to prevent both Dock and tray from being hidden.
- **Synchronization:** per-minute usage polling, six-hour detail refresh, 30-second warm-up timers, and a one-second account-file watcher.
- **Distribution:** macOS ARM/Intel, Linux x64, and Windows x64 release builds; updater metadata/signing; version bump/tag scripts. Ordinary pushes and pull requests do not have a validation workflow in the reference fork.
- **Mobile remnants:** Android/iOS icon assets and a mobile entry attribute exist, but no mobile product configuration or release path was found; this is not part of the desktop parity scope.

## What must not be inherited

- plaintext account credentials in an application JSON file;
- direct, non-atomic official-auth overwrite without backup and verification;
- fixed-passphrase backups or unencrypted compact secret exports;
- unauthenticated `0.0.0.0` routes that can export credentials, mutate accounts, create paid traffic, or kill processes;
- incomplete privacy masking that exposes identity in tray surfaces;
- upstream-owned update endpoints or signing keys;
- OpenAI/Codex OAuth constants, token claims, private endpoints, process signatures, or warm-up payloads.

## Interpretation

“Parity” means equivalent user value where Claude Code provides a supported and secure path. It does not mean matching every Codex-specific capability. Recovery and correctness outrank visible feature count.
