# Security policy

## Supported versions

Security fixes are applied to the latest released minor version.

## Reporting a vulnerability

Do not open a public issue for vulnerabilities that could expose credentials or permit unauthorized account activation. Use GitHub's private vulnerability reporting feature for this repository. Include the affected version, platform, reproduction steps using synthetic data, and expected impact.

Never attach real credentials or complete application-data directories.

## Threat model

Claude Switcher protects stored account snapshots against casual filesystem disclosure by encrypting them with Electron `safeStorage`. It does not protect against an attacker who already controls the user's logged-in OS session, can instrument the running application, or can access the OS credential service as the user.

The application does not transmit credentials. The only network authentication flow is launched through the official Claude Code CLI.

The detailed asset, boundary, abuse-case, and residual-risk analysis is maintained in [docs/THREAT_MODEL.md](docs/THREAT_MODEL.md).

## Released MVP and development status

Released version 0.1 did not provide a complete encrypted recovery boundary: file-backed credentials could be duplicated in plaintext backups and Keychain state was not captured. The development branch replaces that path with OS-encrypted recovery records, transaction journaling, identity verification, and rollback.

Version 0.2 is not release-ready until recovery is exercised on real macOS Keychain, Windows, GNOME Keyring/libsecret, and KWallet environments using tester-owned accounts. Do not use real credentials in automated tests. Keep an independent recovery path through the official `claude auth login` workflow until those gates pass.
