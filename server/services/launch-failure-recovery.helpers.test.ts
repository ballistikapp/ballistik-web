import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);

function stubServerOnlyModule() {
  const serverOnlyPath = require.resolve("server-only");
  require.cache[serverOnlyPath] = {
    id: serverOnlyPath,
    filename: serverOnlyPath,
    loaded: true,
    exports: {},
    children: [],
    path: serverOnlyPath,
    paths: [],
    isPreloading: false,
    parent: undefined,
    require,
  } as unknown as NodeJS.Module;
}

async function loadHelpers() {
  stubServerOnlyModule();
  return import("./launch-failure-recovery.helpers");
}

test("summarizeFailureRecoveryAttempt does not require manual action when all managed wallets are reclaimed or skipped", async () => {
  const { summarizeFailureRecoveryAttempt } = await loadHelpers();
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

test("summarizeFailureRecoveryAttempt requires manual action when any managed wallet reclaim fails", async () => {
  const { summarizeFailureRecoveryAttempt } = await loadHelpers();
  const summary = summarizeFailureRecoveryAttempt([
    { publicKey: "wallet-1", status: "returned", amountSol: 0.4 },
    { publicKey: "wallet-2", status: "failed", error: "network timeout" },
  ]);

  assert.equal(summary.manualActionRequired, true);
  assert.equal(summary.recoveredWalletCount, 1);
  assert.equal(summary.failedWalletCount, 1);
  assert.equal(summary.failureMessage, "Automatic reclaim could not return all wallet SOL.");
});

test("computeFailedLaunchDrainLamports drains the full temporary wallet balance", async () => {
  const { computeFailedLaunchDrainLamports } = await loadHelpers();
  const lamportsToSend = computeFailedLaunchDrainLamports(900_880);

  assert.equal(lamportsToSend, 900_880);
});

test("computeFailedLaunchDrainLamports returns zero for empty wallets", async () => {
  const { computeFailedLaunchDrainLamports } = await loadHelpers();
  const lamportsToSend = computeFailedLaunchDrainLamports(0);

  assert.equal(lamportsToSend, 0);
});

test("computeFailedLaunchDrainLamports caps drain to the plan-funded amount", async () => {
  const { computeFailedLaunchDrainLamports } = await loadHelpers();
  const lamportsToSend = computeFailedLaunchDrainLamports(900_880, 250_000);

  assert.equal(lamportsToSend, 250_000);
});

test("computeFailedLaunchDrainLamports returns zero when funded cap is zero", async () => {
  const { computeFailedLaunchDrainLamports } = await loadHelpers();
  const lamportsToSend = computeFailedLaunchDrainLamports(900_880, 0);

  assert.equal(lamportsToSend, 0);
});
