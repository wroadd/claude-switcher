# Changelog

All notable changes to this project will be documented here.

## [Unreleased]

### Added

- Native macOS menu-bar and cross-platform tray workflow with alias-only profile switching.
- Close-to-background behavior and guarded macOS Dock/menu-bar-only preferences.
- Dedicated 1× and 2× macOS Template icon assets.

### Security

- Tray switching uses the same process, recovery, identity-verification, and rollback coordinator as the main window.
- Missing, invalid, or resize-empty tray images fail closed before the tray can become the application's only visible entry point.
- Pending activation journals now block every new activation before any credential or metadata mutation can begin.
- Partial credential/root-config application failures are injectable and verified to restore the exact previous state.
- Activation and restore rollback failures immediately latch the main process into recovery-required mode, preserving the original recovery identifier.
- A verified activation reports success only after its recovery manifest and journal finalization are durable.

## [0.1.0] - 2026-07-19

### Added

- Secure local capture and activation of Claude Code OAuth profiles.
- OS-backed encrypted credential vault.
- macOS Keychain and credentials-file adapters.
- Timestamped backups and running-session protection.
- React desktop interface with account, activity, and security views.
- Unit tests, CI, release workflow, and developer documentation.
