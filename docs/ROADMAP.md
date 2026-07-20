# Product roadmap

This roadmap is evidence-driven and has no date commitments. Security, recovery, compatibility, and release gates may not be waived to ship feature scope.

## v0.1.0 — Secure local MVP (released)

- [x] capture the current official Claude Code OAuth login;
- [x] encrypt stored snapshots with Electron `safeStorage`;
- [x] support macOS Keychain and credentials-file activation;
- [x] back up file-based Claude configuration before activation;
- [x] block activation when the current process probe finds Claude Code;
- [x] provide local rename, remove, login-launcher, and activity operations.

The audit in `GROUNDTRUTH_AUDIT.md` found that this MVP is useful but not yet a production recovery boundary. In particular, file-backed credential backups are plaintext, Keychain state is not backed up, and activation has no journal, rollback, or post-write identity verification.

## v0.2.0 — Reliable Switching

**Outcome:** a failed switch never silently loses the previous login, and the user has a tested recovery path.

- transactional activation with preflight, journal, post-write identity verification, commit, and automatic rollback;
- complete encrypted recovery bundles for Keychain and file-backed state;
- versioned metadata/vault schemas, migrations, reconciliation, and corruption quarantine;
- backup manifest, integrity validation, retention, and restore UI;
- single-instance enforcement, mutation serialization, and fail-closed process detection;
- runtime-validated IPC, sender checks, stable redacted errors, and Electron navigation/CSP hardening;
- Linux secure-store enforcement with no plaintext fallback;
- secret-free diagnostics and support bundle;
- failure-injection and isolated integration tests on macOS, Windows, and Linux;
- updated threat model and privileged-code review gates.

Release gate: recovery is demonstrated with synthetic credentials on macOS and at least one file-backed platform, CI is green on all supported platforms, and there are no unresolved P0/P1 defects.

## v0.3.0 — Trusted Distribution

- publish and test the supported platform/Claude Code compatibility matrix;
- sign and notarize macOS artifacts and sign Windows artifacts;
- validate Linux packages on declared targets;
- harden release permissions, versioning, checksums, SBOM, and provenance;
- implement a repository-owned, signed updater with rollback behavior;
- test clean install, upgrade, downgrade/recovery, and signature verification.

Release gate: every advertised artifact installs, launches, verifies, and recovers on a clean target. Unsigned artifacts remain development builds.

## v0.4.0 — Native Desktop Workflow

- [x] single-instance native tray/menu-bar lifecycle and safe tray switching;
- [x] alias-only tray presentation and guarded macOS Dock/close behavior;
- [ ] [compact richer tray presentation and additional privacy display modes](https://github.com/wroadd/claude-switcher/issues/23);
- profile metadata refresh, local health checks, and re-authentication guidance;
- search, sorting, masking across all surfaces, theme, keyboard access, and accessibility checks;
- constrained launcher for the official Claude application where supported.

Release gate: every tray operation uses the same transactional coordinator as the main window, and the application always retains a visible recovery/quit path.

Implementation status: the native tray slice is automated-test complete. Manual menu-bar, Dock, and real-account switching checks are deferred and tracked in `VERIFICATION_STATUS.md`; they remain required before a supported release.

## v1.0.0 — Production Readiness

- publish the support, compatibility, privacy, recovery, and update contracts;
- complete onboarding, troubleshooting, incident, and maintainer runbooks;
- run an external clean-machine beta across all supported platforms;
- complete the security and release-readiness review.

Release gate: gates from v0.2–v0.4 remain continuously green and the product has no dependency on undocumented Claude endpoints or credential formats without a conservative compatibility kill switch.

## v1.1.0 — Portable and Project Workflows

- user-passphrase encrypted, versioned export/import with authenticated encryption;
- credential-free alias/preferences transfer;
- confirmation-only per-project profile preferences;
- local CLI companion that shares the audited activation coordinator.

## Discovery track

Discovery issues end with **go**, **no-go**, or **needs external contract** and an ADR. They do not silently become implementation work.

- safe process-scoped API-key session launching without persistence;
- documented Claude subscription usage/quota data;
- explicit, supported manual warm-up behavior and its cost/policy impact;
- authoritative Windows credential storage and Linux secret-store behavior;
- safe import of existing authentication material;
- explicit force-close assistance for Claude processes;
- opt-in telemetry and crash reporting.

## Explicit non-goals until evidence changes

- no consumer quota scraping, terminal-output scraping, or private Anthropic endpoint use;
- no scheduled or automatic paid warm-up activity;
- no raw OAuth credential export;
- no automatic process killing;
- no unauthenticated LAN/cloud credential control or account sharing;
- no plaintext API-key persistence.

See `FEATURE_PARITY.md` for the reference-product mapping and `PROJECT_MANAGEMENT.md` for issue, priority, and release policy.
