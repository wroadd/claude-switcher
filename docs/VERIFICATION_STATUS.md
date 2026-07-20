# Verification status

This file separates repeatable automated evidence from checks that require a real supported desktop, an interactive session, or tester-owned Claude accounts. Deferral means “not release-verified,” not “assumed working.”

## Automated evidence

As of 2026-07-20:

- 52 Node tests cover the activation coordinator, rollback/recovery, storage, IPC, diagnostics, security policy, desktop lifecycle, native tray menu model, and empty-icon fail-closed behavior;
- TypeScript checking and the Vite production build pass;
- the built renderer passes the credential-canary artifact scan;
- the isolated Electron main/renderer security smoke passes locally;
- three-platform CI has previously passed on Ubuntu, macOS, and Windows for the reliable-switching baseline.

These checks use temporary directories, synthetic credential states, and fake OS encryption adapters. They do not read or mutate the developer's real Claude credentials.

The automated activation matrix now includes a failure between credential and root-config mutations, rollback failure with an immutable pending journal, a blocked second activation, ambiguous metadata write reconciliation, commit-finalization failure, restart finalization, and main-process recovery latching for both activation and restore operations. These checks prove the platform-neutral transaction contract; they do not replace the credential-service drills listed below.

The Codex Security diff scan completed with 10/10 review receipts and no reportable security findings. Its only dynamically reproduced hardening candidate—an empty `NativeImage` being accepted as a tray escape path—was subsequently closed in code by checking both the loaded and resized image before constructing `Tray`.

## Deferred manual gates

The following checks are intentionally deferred because suitable test machines, tester accounts, and interactive test time are not currently available:

- visually confirm the 1×/2× macOS Template icon in light and dark menu bars;
- activate tester-owned profiles through the native menu and verify the active Claude identity;
- verify close-to-background, reopen, explicit quit, login-item interaction, and macOS Dock/menu-bar-only transitions;
- run rollback and interrupted-activation drills against a disposable macOS Keychain item;
- repeat file-backed activation/recovery drills on supported Windows and Linux desktop/keyring combinations;
- install and launch signed/notarized production artifacts on clean target systems.

## Gate policy

Do not mark `v0.2.0`, `v0.3.0`, or `v0.4.0` release-ready until their relevant deferred checks have concrete evidence. Continue only with work that can be verified without real credentials or unsupported assumptions; keep mutations fail-closed when platform capabilities are unknown.
