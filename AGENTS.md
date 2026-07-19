# Agent guide

## Project scope

Claude Switcher is an Electron + React desktop application for securely switching local Anthropic Claude Code OAuth profiles.

## Working rules

- Keep all user-facing product and developer documentation in English.
- Never log, render, test-fixture, or commit real credential material.
- Preserve the clean-room boundary from `Lampese/codex-switcher`; do not copy upstream source or assets.
- Treat `electron/` as the privileged boundary. Renderer code must access native behavior only through the narrow preload API.
- Require OS-backed encryption before storing a credential snapshot.
- Create a backup before changing Claude Code authentication state.
- Do not add plaintext API-key persistence.
- Use UTF-8 for all text files.

## Validation

Run `pnpm check` after code changes. For UI changes, run `pnpm dev` and inspect the main account workflow at the minimum supported window size.
