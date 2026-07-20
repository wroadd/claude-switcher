const test = require("node:test");
const assert = require("node:assert/strict");
const { assertMutationsAllowed, recoveryFromOperationError, runRecoveryTrackedOperation } = require("../electron/recovery-state.cjs");

test("rollback failure becomes an authoritative mutation block", () => {
  const error = Object.assign(new Error("synthetic rollback failure"), { code: "ROLLBACK_FAILED", recoveryId: "recovery-123" });
  const recovery = recoveryFromOperationError(error);
  assert.deepEqual(recovery, { status: "recovery-required", recoveryId: "recovery-123", reason: "ROLLBACK_FAILED" });
  assert.throws(
    () => assertMutationsAllowed({ health: { mode: "ready" }, recovery }),
    (blocked) => blocked.code === "RECOVERY_REQUIRED" && blocked.recoveryId === "recovery-123",
  );
});

test("unrelated operation errors do not change recovery state", () => {
  assert.equal(recoveryFromOperationError(Object.assign(new Error("invalid"), { code: "INVALID_ALIAS" })), null);
});

test("every credential operation latches restore rollback failures before rethrowing", async () => {
  const rollbackFailure = Object.assign(new Error("synthetic restore rollback failure"), {
    code: "ROLLBACK_FAILED",
    recoveryId: "restore-recovery-123",
  });
  let recovery = { status: "clear" };
  await assert.rejects(
    () => runRecoveryTrackedOperation(
      async () => { throw rollbackFailure; },
      (nextRecovery) => { recovery = nextRecovery; },
    ),
    (error) => error === rollbackFailure,
  );
  assert.throws(
    () => assertMutationsAllowed({ health: { mode: "ready" }, recovery }),
    (error) => error.code === "RECOVERY_REQUIRED" && error.recoveryId === "restore-recovery-123",
  );
});
