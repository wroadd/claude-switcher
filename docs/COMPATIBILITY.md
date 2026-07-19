# Compatibility matrix

This matrix separates automated evidence from real-platform release gates. A green CI build does not by itself claim credential-adapter support.

| Platform surface | Automated evidence | Human evidence required | Current status |
| --- | --- | --- | --- |
| macOS renderer/store/coordinator | macOS CI runs the full Node/TypeScript/build/canary suite | Keychain present/missing/locked/denied/prompted update and rollback with tester-owned accounts | Human gate |
| macOS Keychain secret transport | Code uses `security ... -w` as the final option and supplies the value through stdin; no delete-before-update | Confirm current supported macOS accepts stdin and preserves access-control behavior | Human gate |
| Windows renderer/store/coordinator | Windows CI runs the same checks | Verify supported Claude Code builds use the expected file authority, permissions, switch, rollback, install, and launch | Human gate |
| Linux renderer/store/coordinator | Ubuntu CI and policy truth-table tests | Real GNOME and KDE desktop sessions | Human gate |
| GNOME Keyring/libsecret | `gnome_libsecret` is accepted; `basic_text`/`unknown` are blocked | Locked/unavailable/unlocked secret-service capture and recovery | Human gate |
| KWallet | `kwallet`, `kwallet5`, and `kwallet6` are accepted | KDE locked/unavailable/unlocked capture and recovery | Human gate |
| Store v1 → v2 | Migration, ciphertext preservation, masked metadata, future read-only, and corruption quarantine tests | Upgrade copy of a redacted/test fixture from the released app | Ready for beta drill |
| Activation/recovery | Success, rollback, fail-closed process uncertainty, crash-after-commit, manual restore, and integrity tests | Clean-machine process race and credential-service failure drill | Human gate |
| Diagnostics | Metadata allowlist, pseudonymization, canary/path/email/token refusal, atomic `0600` export tests | Inspect exports from each packaged platform | Human gate |
| Distribution authenticity | Packaging workflow exists | Apple/Windows signing identities, notarization, signature verification | External gate; v0.3 |

Supported Claude Code versions are not yet declared. Storage keys, status JSON, executable discovery, and adapter precedence can change between releases; an owned-account compatibility sweep and conservative version policy are required before v1.0.
