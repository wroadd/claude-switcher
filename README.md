<p align="center">
  <strong>Claude Switcher</strong>
</p>

<h1 align="center">A secure desktop account switcher for Claude Code</h1>

<p align="center">
  Capture locally authenticated Claude Code accounts, protect their credential snapshots with the operating system, and switch without copying tokens by hand.
</p>

> [!IMPORTANT]
> Claude Switcher is an independent, unofficial project. It is not affiliated with or endorsed by Anthropic. Use it only with accounts you own and in accordance with Anthropic's terms.

## Current status

Version `0.1.0` is an MVP for OAuth/subscription accounts. It provides:

- automatic Claude Code discovery through `claude auth status --json`;
- capture of the currently authenticated Claude identity;
- OS-backed encryption through Electron `safeStorage`;
- activation of saved OAuth profiles;
- macOS Keychain support for the `Claude Code-credentials` item;
- credentials-file support for platforms where Claude Code uses `~/.claude/.credentials.json`;
- timestamped configuration backups before every switch;
- a hard stop when a Claude Code process is running;
- local rename, remove, and activity-history operations;
- a guided launcher for the official `claude auth login` flow.

The development branch now contains the unreleased `v0.2.0 — Reliable Switching` core: a versioned consolidated store, encrypted recovery records, a journaled activation coordinator, post-write identity verification, automatic rollback, strict IPC validation, and fail-closed Linux/process policies. Real-platform recovery drills and restore UI remain release gates.

API-key profiles are not included in this release. Persisting an API key in shell or Claude settings would expose it as plaintext; the feature is deliberately deferred until a secure activation model is available.

## Requirements

- macOS, Windows, or Linux
- Node.js 20, 22, or 24 (Node.js 25+ is not currently supported)
- pnpm 11
- [Claude Code](https://docs.anthropic.com/en/docs/claude-code/getting-started) available on `PATH`

## Development

```bash
git clone https://github.com/wroadd/claude-switcher.git
cd claude-switcher
pnpm install
pnpm dev
```

Run the full validation suite:

```bash
pnpm check
```

Build an installer for the current platform:

```bash
pnpm dist
```

Artifacts are written to `release/`.

## First-use workflow

1. Authenticate Claude Code normally with `claude auth login`.
2. Open Claude Switcher and choose **Add account**.
3. Enter a local alias and choose **Capture current Claude login**.
4. Open the official login flow again, authenticate the next account, and capture it.
5. Close all running Claude Code sessions before activating another saved account.

Claude Switcher never asks for your Claude password. OAuth is always handled by the official Claude Code CLI.

## Security model

Account metadata (alias, masked identity details, timestamps) is stored separately from credentials. Credential bundles are encrypted with Electron `safeStorage`, which delegates to Keychain on macOS, DPAPI on Windows, and the available secret store on Linux. The app refuses to capture credentials when OS-backed encryption is unavailable.

Before activation, the development version encrypts the complete current credential/configuration state into an integrity-checked recovery record and writes a non-secret transaction journal. It applies the selected credential, verifies the resulting identity through `claude auth status --json`, and commits profile metadata last. A failed operation restores and verifies the previous state; an unverifiable recovery blocks further mutations and exposes only a recovery identifier.

See [SECURITY.md](SECURITY.md) for the threat model and reporting process.

## Project documentation

- [Architecture](docs/ARCHITECTURE.md)
- [Codex Switcher feature parity map](docs/FEATURE_PARITY.md)
- [Groundtruth audit](docs/GROUNDTRUTH_AUDIT.md)
- [Threat model](docs/THREAT_MODEL.md)
- [Development guide](docs/DEVELOPMENT.md)
- [Product roadmap](docs/ROADMAP.md)
- [Project management](docs/PROJECT_MANAGEMENT.md)
- [Contributing](CONTRIBUTING.md)
- [Security policy](SECURITY.md)

## Clean-room origin

The product idea was inspired by [Lampese/codex-switcher](https://github.com/Lampese/codex-switcher). That repository did not declare a license when this project was started, so Claude Switcher is a clean-room implementation: no source code or assets were copied. The architecture, interface, credential handling, and documentation in this repository were independently created for Claude Code.

## License

[MIT](LICENSE)
