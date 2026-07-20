# Project management

## Operating model

GitHub issues are the execution source of truth. Documentation records product contracts and decisions; pull requests provide implementation and verification evidence.

### Priorities

- **P0:** credential loss/exposure, incorrect active identity, unsafe privileged boundary, or release blocker;
- **P1:** production security, compatibility, recovery usability, accessibility, or distribution requirement;
- **P2:** committed product value that does not block the current release gate;
- **P3:** refinement or optional improvement.

### Issue types

- `type:bug` — observed behavior violates an accepted contract;
- `type:feature` — accepted implementation work;
- `type:maintenance` — tests, dependencies, tooling, or documentation;
- `type:security` — threat-model or privileged-boundary work;
- `type:spike` — time-bounded discovery ending in an ADR decision.

Area and platform labels identify ownership. `release:blocker` means the milestone cannot close while the issue is open. `clean-room` requires a provenance note demonstrating independent design.

## Definition of ready

An implementation issue is ready when it contains:

- the user-visible or operational outcome;
- scope and explicit non-goals;
- acceptance criteria and required test evidence;
- dependencies and affected platforms;
- security/privacy impact for credentials, storage, IPC, processes, updates, diagnostics, import/export, or shell launch;
- a clean-room provenance note when derived from observed reference behavior.

## Definition of done

- acceptance criteria are demonstrated with synthetic data;
- relevant unit, integration, failure-injection, accessibility, packaging, and platform tests pass;
- `pnpm check` passes;
- documentation, schema version, migration, threat model, and compatibility matrix are updated where affected;
- no real credential, email, token, or private configuration appears in code, fixtures, logs, issues, or artifacts;
- the pull request records security impact, manual verification, and rollback behavior.

## Release governance

1. Every release has an outcome-based milestone and explicit gate in `ROADMAP.md`.
2. P0/P1 recovery, security, compatibility, and authenticity gates cannot be deferred to preserve a date.
3. Preview installers are development artifacts until platform signing and verification are complete.
4. Discovery closes with **go**, **no-go**, or **needs external contract**, recorded in an ADR.
5. Any change to credential formats, storage backends, updater trust, privileged IPC, or process control requires threat-model review.
6. Release evidence names the tested operating systems, Claude Code versions, artifact hashes/signatures, recovery drills, and known limitations.

## Clean-room workflow

Reference products may supply observable behavior and user stories only. Issues and pull requests must not include copied implementation, assets, strings, constants, or undocumented request structures. A parity issue should cite the observed outcome, define a Claude-specific contract, and document the independent design.

## Backlog policy

The complete roadmap lives in `ROADMAP.md`. GitHub initially contains the current milestone's blockers and bounded discovery items; later milestone issues are opened when their dependencies and acceptance criteria are stable. This keeps the issue tracker executable rather than speculative.

## Current execution set

The initial `v0.2.0 — Reliable Switching` issues are:

- [CS-001 transactional activation](https://github.com/wroadd/claude-switcher/issues/1)
- [CS-002 recoverable macOS Keychain replacement](https://github.com/wroadd/claude-switcher/issues/2)
- [CS-003 atomic file-adapter rollback](https://github.com/wroadd/claude-switcher/issues/3)
- [CS-004 versioned schemas and migrations](https://github.com/wroadd/claude-switcher/issues/4)
- [CS-008 IPC validation and authorization](https://github.com/wroadd/claude-switcher/issues/5)
- [CS-010 Linux secure-storage enforcement](https://github.com/wroadd/claude-switcher/issues/6)
- [CS-014 failure-injection tests](https://github.com/wroadd/claude-switcher/issues/7)
- [CS-015 three-platform CI](https://github.com/wroadd/claude-switcher/issues/8)
- [CS-016 threat-model review](https://github.com/wroadd/claude-switcher/issues/9)

The bounded parity discovery set is [DISC-001 API-key sessions](https://github.com/wroadd/claude-switcher/issues/10), [DISC-002 documented usage/quota data](https://github.com/wroadd/claude-switcher/issues/11), and [DISC-003 warm-up behavior](https://github.com/wroadd/claude-switcher/issues/12).

The first executable `v0.4.0 — Native Desktop Workflow` slice is [CS-030 native tray switching and guarded desktop lifecycle](https://github.com/wroadd/claude-switcher/issues/21). Its implementation can complete before manual platform validation, but the milestone release gate cannot.
