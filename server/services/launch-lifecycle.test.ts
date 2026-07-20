import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import type {
  LaunchLifecycleContext,
  LaunchPlatformExecuteResult,
  LaunchPlatformModule,
} from "./launch-platform-registry";

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

function emptyPreviewResult() {
  return {
    money: {
      immediateRequiredBalanceLamports: "0",
      temporaryFundingLamports: "0",
      permanentSpendLamports: "0",
      expectedReturnLamports: "0",
      expectedMainWalletDeltaNowLamports: "0",
      expectedMainWalletDeltaAfterCleanupLamports: "0",
      usageFeeLamports: "0",
      lineItems: [],
    },
    mainWalletBalanceLamports: "0",
    hasSufficientMainWallet: true,
    platformFeeWaived: false,
    platformFeeDiscountRate: 0,
  };
}

function createFakePlatform(
  execute: (ctx: LaunchLifecycleContext) => Promise<LaunchPlatformExecuteResult>
): LaunchPlatformModule {
  return {
    id: "PUMPFUN",
    preview: async () => emptyPreviewResult(),
    plan: async () => ({ planSchemaVersion: 1, plan: {} }),
    execute,
    recover: async () => undefined,
  };
}

test("lifecycle runs Platform execute with progress and cancel context", async () => {
  stubServerOnlyModule();
  const { createLaunchLifecycle } = await import("./launch-lifecycle");

  const progressUpdates: Array<{ progress: number; step?: string }> = [];
  let sawCancelQuery = false;
  let executeCalled = false;

  const lifecycle = createLaunchLifecycle({
    resolvePlatform: () =>
      createFakePlatform(async (ctx) => {
        executeCalled = true;
        assert.equal(ctx.launchId, "launch-1");
        assert.equal(ctx.userId, "user-1");
        await ctx.reportProgress(40, "create");
        sawCancelQuery = await ctx.isCancelRequested();
        await ctx.appendLog("INFO", "fake step", "create");
        return { kind: "compat" };
      }),
    loadLaunch: async () => ({
      id: "launch-1",
      userId: "user-1",
      platform: "PUMPFUN",
      status: "PENDING",
    }),
    reportProgress: async (_launchId, progress, step) => {
      progressUpdates.push({ progress, step });
    },
    appendLog: async () => undefined,
    isCancelRequested: async () => false,
    updateLaunchStatus: async () => undefined,
    collectUsageFee: async () => {
      throw new Error("fees should not run for compat outcomes");
    },
  });

  await lifecycle.runPlatformExecution("launch-1");

  assert.equal(executeCalled, true);
  assert.equal(sawCancelQuery, false);
  assert.deepEqual(progressUpdates, [{ progress: 40, step: "create" }]);
});

test("lifecycle collects usage fees only after Platform success", async () => {
  stubServerOnlyModule();
  const { createLaunchLifecycle } = await import("./launch-lifecycle");

  const feeCalls: Array<{ totalFeeSol: number; referenceId: string }> = [];
  let finalStatus: string | null = null;

  const lifecycle = createLaunchLifecycle({
    resolvePlatform: () =>
      createFakePlatform(async () => ({
        kind: "succeeded",
        usageFeeTotalSol: 0.25,
        userId: "user-1",
        tokenPublicKey: "Token1111111111111111111111111111111111111",
        referenceId: "launch-1",
      })),
    loadLaunch: async () => ({
      id: "launch-1",
      userId: "user-1",
      platform: "PUMPFUN",
      status: "PENDING",
    }),
    reportProgress: async () => undefined,
    appendLog: async () => undefined,
    isCancelRequested: async () => false,
    updateLaunchStatus: async (_launchId, status) => {
      finalStatus = status;
    },
    collectUsageFee: async (input) => {
      feeCalls.push({
        totalFeeSol: input.totalFeeSol,
        referenceId: input.referenceId ?? "",
      });
      return {
        skipped: false,
        signature: "sig",
        fromPublicKey: "from",
        toPublicKey: "to",
        amountSol: input.totalFeeSol,
        amountLamports: 250_000_000,
        reason: input.reason,
        transfers: [],
        referralPayout: null,
      };
    },
  });

  await lifecycle.runPlatformExecution("launch-1");

  assert.deepEqual(feeCalls, [{ totalFeeSol: 0.25, referenceId: "launch-1" }]);
  assert.equal(finalStatus, "SUCCEEDED");
});

test("lifecycle does not downgrade success when usage fee collection fails", async () => {
  stubServerOnlyModule();
  const { createLaunchLifecycle } = await import("./launch-lifecycle");

  let finalStatus: string | null = null;
  const warnings: string[] = [];

  const lifecycle = createLaunchLifecycle({
    resolvePlatform: () =>
      createFakePlatform(async () => ({
        kind: "succeeded",
        usageFeeTotalSol: 0.25,
        userId: "user-1",
        tokenPublicKey: "Token1111111111111111111111111111111111111",
        referenceId: "launch-1",
      })),
    loadLaunch: async () => ({
      id: "launch-1",
      userId: "user-1",
      platform: "PUMPFUN",
      status: "PENDING",
    }),
    reportProgress: async () => undefined,
    appendLog: async (_launchId, level, message) => {
      if (level === "WARN") {
        warnings.push(message);
      }
    },
    isCancelRequested: async () => false,
    updateLaunchStatus: async (_launchId, status) => {
      finalStatus = status;
    },
    collectUsageFee: async () => {
      throw new Error("collector unavailable");
    },
  });

  await lifecycle.runPlatformExecution("launch-1");

  assert.equal(finalStatus, "SUCCEEDED");
  assert.equal(warnings.length, 1);
  assert.match(warnings[0] ?? "", /Usage fee collection failed/i);
});

test("lifecycle skips fee collection for non-success Platform outcomes", async () => {
  stubServerOnlyModule();
  const { createLaunchLifecycle } = await import("./launch-lifecycle");

  let feeCalled = false;
  let finalStatus: string | null = null;

  const lifecycle = createLaunchLifecycle({
    resolvePlatform: () =>
      createFakePlatform(async () => ({
        kind: "failed",
        errorMessage: "RPC timeout",
      })),
    loadLaunch: async () => ({
      id: "launch-1",
      userId: "user-1",
      platform: "PUMPFUN",
      status: "PENDING",
    }),
    reportProgress: async () => undefined,
    appendLog: async () => undefined,
    isCancelRequested: async () => false,
    updateLaunchStatus: async (_launchId, status) => {
      finalStatus = status;
    },
    collectUsageFee: async () => {
      feeCalled = true;
      throw new Error("should not collect");
    },
  });

  await lifecycle.runPlatformExecution("launch-1");

  assert.equal(feeCalled, false);
  assert.equal(finalStatus, "FAILED");
});
