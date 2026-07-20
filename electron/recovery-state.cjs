function recoveryFromOperationError(error) {
  if (!["ROLLBACK_FAILED", "RECOVERY_REQUIRED"].includes(error?.code) || !error?.recoveryId) return null;
  return { status: "recovery-required", recoveryId: error.recoveryId, reason: error.code };
}

function assertMutationsAllowed({ health, recovery }) {
  if (health.mode !== "ready") {
    const error = new Error(health.mode === "read-only"
      ? "This profile store was created by a newer Claude Switcher version and is read-only."
      : `Profile store recovery is required. Quarantine: ${health.quarantine || "unknown"}`);
    error.code = health.reason;
    throw error;
  }
  if (recovery.status === "recovery-required") {
    const error = new Error(`An interrupted activation requires recovery before changes can continue. Recovery ID: ${recovery.recoveryId}`);
    error.code = "RECOVERY_REQUIRED";
    error.recoveryId = recovery.recoveryId || null;
    throw error;
  }
}

async function runRecoveryTrackedOperation(operation, setRecovery) {
  try {
    return await operation();
  } catch (error) {
    const nextRecovery = recoveryFromOperationError(error);
    if (nextRecovery) setRecovery(nextRecovery);
    throw error;
  }
}

module.exports = { assertMutationsAllowed, recoveryFromOperationError, runRecoveryTrackedOperation };
