# Security policy

## Supported versions

Security fixes are applied to the latest released minor version.

## Reporting a vulnerability

Do not open a public issue for vulnerabilities that could expose credentials or permit unauthorized account activation. Use GitHub's private vulnerability reporting feature for this repository. Include the affected version, platform, reproduction steps using synthetic data, and expected impact.

Never attach real credentials or complete application-data directories.

## Threat model

Claude Switcher protects stored account snapshots against casual filesystem disclosure by encrypting them with Electron `safeStorage`. It does not protect against an attacker who already controls the user's logged-in OS session, can instrument the running application, or can access the OS credential service as the user.

The application does not transmit credentials. The only network authentication flow is launched through the official Claude Code CLI.

## Current MVP limitations

Version 0.1 does not yet provide a complete encrypted recovery boundary. File-backed Claude credentials can be duplicated in a timestamped plaintext backup protected only by filesystem permissions, while macOS Keychain credentials are not included in that backup. Activation is not journaled and has no automatic rollback or post-write identity verification. These limitations are P0 work in the v0.2 Reliable Switching milestone; see `docs/GROUNDTRUTH_AUDIT.md`.

Do not use real credentials when testing backup, failure, or recovery behavior. Until v0.2 gates pass, keep an independent recovery path through the official `claude auth login` workflow.
