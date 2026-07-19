# Security policy

## Supported versions

Security fixes are applied to the latest released minor version.

## Reporting a vulnerability

Do not open a public issue for vulnerabilities that could expose credentials or permit unauthorized account activation. Use GitHub's private vulnerability reporting feature for this repository. Include the affected version, platform, reproduction steps using synthetic data, and expected impact.

Never attach real credentials or complete application-data directories.

## Threat model

Claude Switcher protects stored account snapshots against casual filesystem disclosure by encrypting them with Electron `safeStorage`. It does not protect against an attacker who already controls the user's logged-in OS session, can instrument the running application, or can access the OS credential service as the user.

The application does not transmit credentials. The only network authentication flow is launched through the official Claude Code CLI.
