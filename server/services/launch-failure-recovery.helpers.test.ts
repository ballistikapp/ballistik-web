import assert from "node:assert/strict";
import test from "node:test";
import {
  computeFailedLaunchDrainLamports,
  summarizeFailureRecoveryAttempt,
} from "./launch-failure-recovery.helpers";

test("summarizeFailureRecoveryAttempt does not require manual action when all managed wallets are reclaimed or skipped", () => {
  const summary = summarizeFailureRecoveryAttempt([
    { publicKey: "wallet-1", status: "returned", amountSol: 0.4 },
    { publicKey: "wallet-2", status: "skipped" },
    { publicKey: "wallet-3", status: "returned", amountSol: 0.1 },
  ]);

  assert.equal(summary.attempted, true);
  assert.equal(summary.manualActionRequired, false);
  assert.equal(summary.recoveredWalletCount, 2);
  assert.equal(summary.failedWalletCount, 0);
  assert.equal(summary.totalReturnedSol, 0.5);
});

test("summarizeFailureRecoveryAttempt requires manual action when any managed wallet reclaim fails", () => {
  const summary = summarizeFailureRecoveryAttempt([
    { publicKey: "wallet-1", status: "returned", amountSol: 0.4 },
    { publicKey: "wallet-2", status: "failed", error: "network timeout" },
  ]);

  assert.equal(summary.manualActionRequired, true);
  assert.equal(summary.recoveredWalletCount, 1);
  assert.equal(summary.failedWalletCount, 1);
  assert.equal(summary.failureMessage, "Automatic reclaim could not return all wallet SOL.");
});

test("computeFailedLaunchDrainLamports drains the full temporary wallet balance", () => {
  const lamportsToSend = computeFailedLaunchDrainLamports(900_880);

  assert.equal(lamportsToSend, 900_880);
});

test("computeFailedLaunchDrainLamports returns zero for empty wallets", () => {
  const lamportsToSend = computeFailedLaunchDrainLamports(0);

  assert.equal(lamportsToSend, 0);
});
