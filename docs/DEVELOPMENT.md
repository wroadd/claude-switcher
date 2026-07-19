# Development guide

## Repository layout

```text
electron/              privileged Electron main process and preload bridge
src/                   React renderer
tests/                 Node unit tests for storage and normalization
docs/                  architecture, roadmap, and design material
.github/workflows/     CI and release automation
```

## Commands

```bash
pnpm install           install dependencies
pnpm dev               run Vite and Electron in development mode
pnpm test              run Node unit tests
pnpm build             type-check and build the renderer
pnpm check             run tests and build
pnpm dist              package the current platform
```

Pull requests run `pnpm check` on Ubuntu, macOS, and Windows. Repository branch protection should require all three `CI / check` jobs. Credential-service behavior that hosted runners cannot reproduce must be recorded as a manual release gate rather than silently skipped.

Use an even-numbered LTS Node.js release from 20 through 24. The Electron 37 installer is not compatible with the experimental Node.js 26 runtime.

## Safe test strategy

Unit tests use temporary directories and a fake encryption adapter. They must never read the developer's real Claude credentials. Manual credential switching should be tested only with accounts owned by the tester and after closing every Claude Code session.

## Release process

1. Update the version in `package.json`.
2. Add user-visible changes to `CHANGELOG.md`.
3. Run `pnpm check` on a clean checkout.
4. Tag the commit as `v<version>`.
5. Push the tag. The release workflow builds platform artifacts and creates a draft GitHub release.
