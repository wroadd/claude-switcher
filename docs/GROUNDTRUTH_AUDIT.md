# Groundtruth audit

Date: 2026-07-19  
Scope: tracked files in Claude Switcher and the user-owned Codex Switcher fork  
Method: one finite, read-only Groundtruth loop; every required area is classified with evidence and severity

This table records the pre-v0.2 baseline at commit `97e711e`. Remediation status is tracked through the v0.2 milestone issues and the current architecture/threat-model documents; the historical findings are retained rather than rewritten.

Outcomes are **proved**, **weak**, **no issue**, **not applicable**, or **unverified**. Severity is P0 (release blocker), P1 (production hardening), P2 (planned improvement), or none.

| Area | Outcome | Severity | Evidence and conclusion |
| --- | --- | --- | --- |
| Architecture | Weak | P0 | `electron/main.cjs`, `preload.cjs`, `profile-store.cjs`, and `claude-service.cjs` form sensible trust zones, but credential/config/vault/metadata writes do not form one transaction. |
| Platform compatibility | Unverified | P0 | macOS Keychain and file adapters exist; Windows/Linux credential authority, GUI `PATH`, process signatures, and supported Claude versions have no tested matrix. |
| Security boundaries | Weak | P0 | `safeStorage`, renderer sandboxing, and context isolation are present. IPC inputs/senders, CSP, navigation, permissions, production dev-URL behavior, and Linux secure-store fallback need enforcement. |
| Privileged state changes | Weak | P0 | File-backed credentials are copied into plaintext backups; Keychain state is not backed up; Keychain replacement can delete before a successful add; no rollback or identity verification exists. |
| Data integrity | Weak | P0 | Metadata and vault use separate files without shared revision, schema migration, lock, reconciliation, or deterministic corruption recovery. |
| Process safety | Weak | P0 | Process inspection can miss hosted/child processes and returns clear on probe errors. Activation is not serialized against another app instance or operation. |
| Performance and limits | Weak | P1 | The MVP scale is small, but IPC/store payload sizes and several histories are not consistently bounded; no load or abuse tests exist. |
| Deployment and supply chain | Weak | P1 | CI checks Ubuntu and release workflows package platforms, but artifacts are not signed/notarized, smoke-installed, checksummed, or accompanied by SBOM/provenance. |
| Background jobs | Not applicable | none | The MVP has no schedulers, updater, polling tray, telemetry, or warm-up jobs. Future jobs require lifecycle and consent gates. |
| Product/business logic | Weak | P0 | The UI active marker is committed without verifying the identity reported by Claude Code. External `claude auth login` changes are not reconciled on startup. |
| Code quality and tests | Weak | P0 | Four unit tests cover service/store primitives. There are no failure-injection, integration, IPC, concurrency, migration, UI, packaging, or real-platform adapter tests. |
| Documentation | Weak | P1 | The architecture and threat model are clear, but prior text overstated backup protection and masked metadata. This audit and roadmap correct the claims; recovery runbooks remain future work. |
| Reference-product provenance | Proved | P0 | The audited fork has no tracked license. Clean-room, behavior-only requirements are mandatory. |

## Gate G0 — reliable switching

Feature expansion is blocked until all of the following are proved with synthetic fixtures:

1. preflight validates every input and authoritative backend before mutation;
2. a complete encrypted recovery bundle captures every state element that will change;
3. a journaled coordinator serializes activation and commits metadata last;
4. `claude auth status --json` verifies the intended identity after the write;
5. every injected failure rolls back and verifies the prior identity;
6. interrupted journals recover safely on next start;
7. schema migration, corruption quarantine, and state reconciliation are deterministic;
8. macOS plus one file-backed platform pass the recovery drill.

## Reference-product audit result

The reference fork provides valuable UX requirements—especially tray-first switching, lifecycle polish, transfer workflows, and release automation—but its credential store, direct auth overwrite, fixed-passphrase/unencrypted exports, LAN command surface, masking, and update ownership are not acceptable implementation models.

## Audit boundary

This pass inspected tracked source, configuration, workflows, documentation, and test surfaces. It did not exercise real credentials, modify Claude configuration, install release artifacts on clean machines, or validate undocumented Anthropic behavior. Those remain explicit test or external-contract gates.
