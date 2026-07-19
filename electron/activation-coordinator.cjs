const crypto = require("node:crypto");

class ActivationError extends Error {
  constructor(code, message, recoveryId = null) {
    super(message);
    this.name = "ActivationError";
    this.code = code;
    this.recoveryId = recoveryId;
  }
}

class ActivationCoordinator {
  constructor({ store, adapter, failpoint = async () => {} }) {
    this.store = store;
    this.adapter = adapter;
    this.failpoint = failpoint;
    this.tail = Promise.resolve();
  }

  async serialized(operation) {
    const run = this.tail.then(operation, operation);
    this.tail = run.catch(() => {});
    return run;
  }

  async ensureClear() {
    const probe = await this.adapter.probeClaudeProcesses();
    if (probe.status === "blocked") throw new ActivationError("CLAUDE_RUNNING", "Close all running Claude Code sessions before switching accounts, then try again.");
    if (probe.status !== "clear") throw new ActivationError("PROCESS_STATUS_UNKNOWN", "Claude Code process status could not be verified. Switching was blocked for safety.");
  }

  async activate(profileId) {
    return this.serialized(async () => {
      await this.ensureClear();
      await this.failpoint("after-process-check");
      const target = await this.store.secret(profileId);
      const metadataBefore = await this.store.metadata();
      const previousActiveId = metadataBefore.accounts.find((account) => account.active)?.id || null;
      const previous = await this.adapter.captureCredentialState({ requireLogin: false });
      await this.failpoint("after-preflight");

      const transactionId = crypto.randomUUID();
      const recovery = await this.store.createRecoveryRecord({
        transactionId,
        targetProfileId: profileId,
        adapter: previous.credentials.source,
        state: previous,
      });
      await this.failpoint("after-recovery-write");
      const journal = {
        transactionId, recoveryId: recovery.id, targetProfileId: profileId,
        adapter: previous.credentials.source, previousActiveId, phase: "prepared", updatedAt: new Date().toISOString(),
      };
      await this.store.writeJournal(journal);

      let metadataCommitted = false;
      try {
        await this.failpoint("after-journal-write");
        if (this.adapter.credentialStateMatches) {
          const currentBeforeApply = await this.adapter.captureCredentialState({ requireLogin: false });
          if (!this.adapter.credentialStateMatches(previous, currentBeforeApply)) {
            await this.store.updateRecoveryStatus(recovery.id, "rolled-back");
            await this.store.clearJournal();
            throw new ActivationError("CONCURRENT_AUTH_CHANGE", "Claude authentication changed during activation preflight. No switch was performed.", recovery.id);
          }
        }
        await this.adapter.applyCredentialBundle(target, previous.credentials.source);
        journal.phase = "applied";
        journal.updatedAt = new Date().toISOString();
        await this.store.writeJournal(journal);
        await this.failpoint("after-credential-apply");

        const actual = await this.adapter.getClaudeStatus();
        if (!this.adapter.identityMatches(target.status, actual)) {
          throw new ActivationError("IDENTITY_VERIFICATION_FAILED", "Claude Code did not report the selected identity after activation.", recovery.id);
        }
        journal.phase = "verified";
        journal.updatedAt = new Date().toISOString();
        await this.store.writeJournal(journal);
        await this.failpoint("after-identity-verify");

        await this.store.markActive(profileId, { transactionId, recoveryId: recovery.id });
        metadataCommitted = true;
        journal.phase = "metadata-committed";
        journal.updatedAt = new Date().toISOString();
        await this.store.writeJournal(journal);
        await this.failpoint("after-metadata-commit");
        await this.store.updateRecoveryStatus(recovery.id, "committed");
        await this.store.clearJournal();
        return { transactionId, recoveryId: recovery.id };
      } catch (cause) {
        if (cause?.code === "CONCURRENT_AUTH_CHANGE") throw cause;
        if (metadataCommitted) {
          const actual = await this.adapter.getClaudeStatus().catch(() => null);
          if (actual && this.adapter.identityMatches(target.status, actual)) {
            await this.store.updateRecoveryStatus(recovery.id, "committed").catch(() => {});
            await this.store.clearJournal().catch(() => {});
            return { transactionId, recoveryId: recovery.id };
          }
        }
        try {
          journal.phase = "rolling-back";
          journal.updatedAt = new Date().toISOString();
          await this.store.writeJournal(journal);
          await this.adapter.restoreCredentialState(previous);
          await this.failpoint("after-rollback-apply");
          const restored = await this.adapter.getClaudeStatus();
          if (previous.status?.loggedIn && !this.adapter.identityMatches(previous.status, restored)) {
            throw new Error("Previous Claude identity could not be verified after rollback.");
          }
          if (metadataCommitted && previousActiveId) await this.store.markActive(previousActiveId, { transactionId, recoveryId: recovery.id, rollback: true });
          await this.store.updateRecoveryStatus(recovery.id, "rolled-back");
          await this.store.clearJournal();
          await this.store.recordFailure(profileId, "activation-rolled-back", { transactionId, recoveryId: recovery.id, code: cause.code || "ACTIVATION_FAILED" });
          throw new ActivationError(
            cause.code || "ACTIVATION_FAILED",
            `Activation failed and the previous login was restored. Recovery ID: ${recovery.id}`,
            recovery.id,
          );
        } catch (rollbackError) {
          if (rollbackError instanceof ActivationError && rollbackError.message.includes("was restored")) throw rollbackError;
          await this.store.updateRecoveryStatus(recovery.id, "rollback-failed").catch(() => {});
          journal.phase = "recovery-required";
          journal.updatedAt = new Date().toISOString();
          await this.store.writeJournal(journal).catch(() => {});
          await this.store.recordFailure(profileId, "activation-recovery-required", { transactionId, recoveryId: recovery.id, code: "ROLLBACK_FAILED" }).catch(() => {});
          throw new ActivationError("ROLLBACK_FAILED", `Activation failed and automatic recovery could not be verified. Recovery ID: ${recovery.id}`, recovery.id);
        }
      }
    });
  }

  async recoverPending() {
    const journal = await this.store.readJournal();
    if (!journal) return { status: "clear" };
    const probe = await this.adapter.probeClaudeProcesses();
    if (probe.status !== "clear") return { status: "recovery-required", recoveryId: journal.recoveryId, reason: "CLAUDE_PROCESS_STATE" };
    try {
      const metadata = await this.store.metadata();
      const activeId = metadata.accounts.find((account) => account.active)?.id || null;
      if (["verified", "metadata-committed"].includes(journal.phase) && activeId === journal.targetProfileId) {
        const target = await this.store.secret(journal.targetProfileId);
        const actual = await this.adapter.getClaudeStatus();
        if (this.adapter.identityMatches(target.status, actual)) {
          await this.store.updateRecoveryStatus(journal.recoveryId, "committed");
          await this.store.clearJournal();
          return { status: "recovered", recoveryId: journal.recoveryId };
        }
      }
      const recovery = await this.store.readRecoveryRecord(journal.recoveryId);
      await this.adapter.restoreCredentialState(recovery.state);
      const actual = await this.adapter.getClaudeStatus();
      if (recovery.state.status?.loggedIn && !this.adapter.identityMatches(recovery.state.status, actual)) {
        throw new Error("Recovered identity could not be verified.");
      }
      if (journal.previousActiveId) await this.store.markActive(journal.previousActiveId, { transactionId: journal.transactionId, recoveryId: journal.recoveryId, startupRollback: true });
      await this.store.updateRecoveryStatus(journal.recoveryId, "rolled-back");
      await this.store.clearJournal();
      return { status: "recovered", recoveryId: journal.recoveryId };
    } catch {
      await this.store.updateRecoveryStatus(journal.recoveryId, "rollback-failed").catch(() => {});
      return { status: "recovery-required", recoveryId: journal.recoveryId, reason: "RECOVERY_FAILED" };
    }
  }
}

module.exports = { ActivationCoordinator, ActivationError };
