# Threat model

## Scope

This model covers the renderer, preload bridge, Electron main process, profile store, operating-system credential adapters, recovery records, Claude CLI execution, and build/release workflows. It is reconciled for every minor release and whenever a privileged boundary changes.

## Assets

- live Claude credentials and official Claude configuration;
- encrypted profile snapshots and encrypted recovery records;
- profile metadata, active-state correctness, and local activity;
- activation journals and recovery identifiers;
- release artifacts, update metadata, signing identities, and CI credentials.

## Trust boundaries

| Boundary | Entry points | Required controls |
| --- | --- | --- |
| Renderer → preload → main | Typed IPC channels | Exact schemas, main-frame/sender authorization, bounded inputs, secret-free errors |
| Main → filesystem/OS secret store | Capture, activation, rollback, migration | OS encryption, atomic writes, restrictive modes, encrypted recovery, integrity checks |
| Main → Claude CLI/process table | Status, login, process guard | Fixed commands, timeouts, output limits, fail-closed process state, no raw output logs |
| Renderer → browser capabilities | Navigation, windows, permissions | Sandbox, context isolation, CSP, deny navigation/windows/webviews/permissions |
| CI → release artifacts | Dependencies, workflows, packaging | Least privilege, three-platform checks, canary scan, signing and provenance gates |

## Actors and assumptions

- accidental action, interruption, or disk failure;
- malformed, corrupt, future-version, or externally changed configuration;
- compromised renderer content or foreign frame;
- another local process racing files or exposed boundaries;
- filesystem reader without access to the logged-in OS credential service;
- compromised dependency, workflow, artifact, or update channel.

An attacker controlling the logged-in OS session, instrumenting the main process, or authorized to use the same OS credential service remains outside the protection boundary. JavaScript cannot guarantee secret zeroization; secret lifetime and duplication are minimized instead.

## Abuse cases and disposition

| Abuse case | Mitigation/evidence | Residual disposition |
| --- | --- | --- |
| Crash leaves mixed credential/config/metadata state | Journaled coordinator, encrypted recovery, atomic writes, identity verification, rollback tests | Real-platform recovery drills remain release gates |
| Keychain replacement loses current login | Update without delete, encrypted prior snapshot, rollback | macOS prompt/ACL behavior is a human gate |
| Plaintext backup exposes credentials | Recovery payload is `safeStorage` ciphertext; manifest contains no identity/secret | Legacy v0.1 backups require cleanup guidance |
| Renderer sends coerced, oversized, or path-like IPC | Exact envelope validation and authorized sender tests | Accepted |
| Remote/dev page receives privileged preload | Packaged builds ignore dev URL; dev origin is exact loopback; navigation/windows/webviews denied | CSP remains regression-tested |
| Linux silently uses `basic_text` | Backend inspection blocks writes unless libsecret/KWallet is selected | Real desktop sessions are a human gate |
| Process inspection fails and switching proceeds | Tri-state probe; `unknown` blocks activation | Signatures require compatibility tests |
| Wrong account is shown active | CLI identity matches before metadata commit; startup reconciles journal | Unknown CLI status fails closed |
| Corrupt/future store is overwritten | Corruption is quarantined; future schema opens read-only; mutations block | Restore/import UI remains planned |
| Secrets enter logs, errors, or artifacts | Stable errors, metadata-only journals/manifests, canary tests/build scan | Same-process memory inspection is out of scope |
| Compromised installer/update | No trusted updater before signing, checksums, SBOM/provenance, clean-machine tests | Blocked for v0.3 |
| Export or LAN control expands exposure | Raw OAuth export and unauthenticated LAN control are rejected | Requires separate approved design |

## Security review triggers

Review is mandatory for `electron/**`, preload/IPC, credential adapters, schemas/migrations, backups/recovery, import/export, diagnostics, child processes, shell/network access, updater behavior, build workflows, or security-sensitive dependencies. Evidence must include synthetic tests, failure behavior, rollback, platforms, and documentation updates.

## Human and external gates

- macOS Keychain update/rollback with locked, denied, missing, and prompted access;
- Windows Claude credential authority and file behavior on supported builds;
- GNOME Keyring/libsecret and KWallet behavior in real desktop sessions;
- clean-machine crash/recovery drills with tester-owned accounts;
- branch-protection administration;
- Apple/Windows signing identities and protected CI secrets.
