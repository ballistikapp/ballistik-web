import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import {
  LAUNCH_INPUT_SCHEMA_VERSION_V1,
  type VersionedLaunchInput,
} from "@/server/schemas/launch-platform.schema";
import type {
  LaunchLifecycleContext,
  LaunchPlatformExecuteResult,
  LaunchPlatformModule,
  LaunchPlatformPlanResult,
} from "./launch-platform-registry";
import type { LaunchLifecycleDeps } from "./launch-lifecycle";
import { samplePumpfunPlatformPlan } from "./test-launch-plan-fixtures";

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

const sampleInput: VersionedLaunchInput = {
  schemaVersion: LAUNCH_INPUT_SCHEMA_VERSION_V1,
  platform: "PUMPFUN",
  metadata: {
    tokenName: "Test",
    tokenSymbol: "TST",
    tokenImage: "https://example.com/a.png",
  },
  options: {
    vanityMint: false,
    removeAttribution: false,
  },
  config: {
    devWalletOption: "use_main",
    devBuyAmountSol: 0.1,
    jitoTipAmountSol: 0,
    bundleBuyEnabled: false,
    mayhemMode: false,
    bundlerWalletCount: 0,
    bundlerBuyAmountSol: 0.05,
    bundlerBuyVariancePercent: 0,
    distributionWalletMultiplier: 1,
  },
};

function createFakePlatform(handlers: {
  plan?: (
    ctx: LaunchLifecycleContext,
    input: VersionedLaunchInput
  ) => Promise<LaunchPlatformPlanResult>;
  execute?: (
    ctx: LaunchLifecycleContext
  ) => Promise<LaunchPlatformExecuteResult>;
  compensatePlanResources?: LaunchPlatformModule["compensatePlanResources"];
}): LaunchPlatformModule {
  return {
    id: "PUMPFUN",
    preview: async () => emptyPreviewResult(),
    plan:
      handlers.plan ??
      (async () => ({
        kind: "planned",
        planSchemaVersion: "1",
        plan: samplePumpfunPlatformPlan(),
      })),
    execute: handlers.execute ?? (async () => ({ kind: "canceled" })),
    recover: async () => ({
      mainWalletPublicKey: "Main111",
      results: [],
    }),
    compensatePlanResources:
      handlers.compensatePlanResources ?? (async () => undefined),
  };
}

function baseDeps(
  overrides: Partial<LaunchLifecycleDeps> & {
    resolvePlatform: LaunchLifecycleDeps["resolvePlatform"];
  }
): LaunchLifecycleDeps {
  return {
    loadLaunch: async () => ({
      id: "launch-1",
      userId: "user-1",
      platform: "PUMPFUN",
      status: "PENDING",
      plan: null,
      planSchemaVersion: null,
      planPersistedAt: null,
      input: sampleInput,
    }),
    persistPlan: async () => undefined,
    reportProgress: async () => undefined,
    appendLog: async () => undefined,
    isCancelRequested: async () => false,
    updateLaunchStatus: async () => undefined,
    collectUsageFee: async () => {
      throw new Error("fees should not run");
    },
    ...overrides,
  };
}

test("lifecycle persists plan before execute and passes exact plan to execute", async () => {
  stubServerOnlyModule();
  const { createLaunchLifecycle } = await import("./launch-lifecycle");

  const events: string[] = [];
  const planned = samplePumpfunPlatformPlan();

  const lifecycle = createLaunchLifecycle(
    baseDeps({
      resolvePlatform: () =>
        createFakePlatform({
          plan: async () => {
            events.push("plan");
            return {
              kind: "planned",
              planSchemaVersion: "1",
              plan: planned,
            };
          },
          execute: async (ctx) => {
            events.push("execute");
            assert.equal(ctx.planSchemaVersion, "1");
            assert.ok(ctx.plan && typeof ctx.plan === "object");
            assert.equal(
              (ctx.plan as { shellVersion?: string }).shellVersion,
              "1"
            );
            assert.deepEqual(
              (ctx.plan as { platformPlan?: unknown }).platformPlan,
              planned
            );
            return { kind: "canceled" };
          },
        }),
      persistPlan: async (_launchId, version, plan) => {
        events.push("persist");
        assert.equal(version, "1");
        assert.equal((plan as { shellVersion?: string }).shellVersion, "1");
        assert.deepEqual(
          (plan as { platformPlan?: unknown }).platformPlan,
          planned
        );
      },
    })
  );

  await lifecycle.runPlatformExecution("launch-1");

  assert.deepEqual(events, ["plan", "persist", "execute"]);
});

test("lifecycle marks FAILED and skips execute when planning fails", async () => {
  stubServerOnlyModule();
  const { createLaunchLifecycle } = await import("./launch-lifecycle");

  let executeCalled = false;
  let finalStatus: string | null = null;
  let errorMessage: string | null | undefined;

  const lifecycle = createLaunchLifecycle(
    baseDeps({
      resolvePlatform: () =>
        createFakePlatform({
          plan: async () => ({
            kind: "failed",
            errorMessage:
              "Main wallet requires 1.2500 SOL to fund launch wallets and usage fees",
          }),
          execute: async () => {
            executeCalled = true;
            return { kind: "canceled" };
          },
        }),
      updateLaunchStatus: async (_launchId, status, message) => {
        finalStatus = status;
        errorMessage = message;
      },
    })
  );

  await lifecycle.runPlatformExecution("launch-1");

  assert.equal(executeCalled, false);
  assert.equal(finalStatus, "FAILED");
  assert.match(errorMessage ?? "", /Main wallet requires/i);
});

test("lifecycle compensates and marks FAILED when plan persistence fails", async () => {
  stubServerOnlyModule();
  const { createLaunchLifecycle } = await import("./launch-lifecycle");

  const events: string[] = [];
  let finalStatus: string | null = null;

  const lifecycle = createLaunchLifecycle(
    baseDeps({
      resolvePlatform: () =>
        createFakePlatform({
          plan: async () => ({
            kind: "planned",
            planSchemaVersion: "1",
            plan: samplePumpfunPlatformPlan(),
            localResources: {
              reservedVanityMintId: null,
              createdWalletPublicKeys: ["Wallet111"],
            },
          }),
          execute: async () => {
            events.push("execute");
            return { kind: "canceled" };
          },
          compensatePlanResources: async (_ctx, resources) => {
            events.push("compensate");
            assert.equal(resources.reservedVanityMintId, null);
            assert.deepEqual(resources.createdWalletPublicKeys, ["Wallet111"]);
          },
        }),
      persistPlan: async () => {
        events.push("persist");
        throw new Error("db write failed");
      },
      updateLaunchStatus: async (_launchId, status) => {
        finalStatus = status;
      },
    })
  );

  await lifecycle.runPlatformExecution("launch-1");

  assert.deepEqual(events, ["persist", "compensate"]);
  assert.equal(finalStatus, "FAILED");
});

test("lifecycle skips planning when an authoritative plan is already persisted", async () => {
  stubServerOnlyModule();
  const { createLaunchLifecycle } = await import("./launch-lifecycle");

  let planCalled = false;
  let sawPlan: unknown = null;

  const existingPlan = { wallets: { mainWalletPublicKey: "Main222" } };

  const lifecycle = createLaunchLifecycle(
    baseDeps({
      resolvePlatform: () =>
        createFakePlatform({
          plan: async () => {
            planCalled = true;
            return {
              kind: "planned",
              planSchemaVersion: "1",
              plan: { shouldNot: "run" },
            };
          },
          execute: async (ctx) => {
            sawPlan = ctx.plan;
            return { kind: "canceled" };
          },
        }),
      loadLaunch: async () => ({
        id: "launch-1",
        userId: "user-1",
        platform: "PUMPFUN",
        status: "PENDING",
        plan: existingPlan,
        planSchemaVersion: "1",
        planPersistedAt: new Date("2026-07-20T00:00:00.000Z"),
        input: sampleInput,
      }),
      persistPlan: async () => {
        throw new Error("should not persist again");
      },
    })
  );

  await lifecycle.runPlatformExecution("launch-1");

  assert.equal(planCalled, false);
  assert.deepEqual(sawPlan, existingPlan);
});

test("lifecycle runs Platform execute with progress and cancel context", async () => {
  stubServerOnlyModule();
  const { createLaunchLifecycle } = await import("./launch-lifecycle");

  const progressUpdates: Array<{ progress: number; step?: string }> = [];
  let sawCancelQuery = false;
  let executeCalled = false;

  const lifecycle = createLaunchLifecycle(
    baseDeps({
      resolvePlatform: () =>
        createFakePlatform({
          execute: async (ctx) => {
            executeCalled = true;
            assert.equal(ctx.launchId, "launch-1");
            assert.equal(ctx.userId, "user-1");
            await ctx.reportProgress(40, "create");
            sawCancelQuery = await ctx.isCancelRequested();
            await ctx.appendLog("INFO", "fake step", "create");
            return { kind: "canceled" };
          },
        }),
      reportProgress: async (_launchId, progress, step) => {
        progressUpdates.push({ progress, step });
      },
      isCancelRequested: async () => false,
    })
  );

  await lifecycle.runPlatformExecution("launch-1");

  assert.equal(executeCalled, true);
  assert.equal(sawCancelQuery, false);
  assert.deepEqual(progressUpdates, [
    { progress: 2, step: "plan" },
    { progress: 40, step: "create" },
  ]);
});

test("lifecycle collects usage fees only after Platform success", async () => {
  stubServerOnlyModule();
  const { createLaunchLifecycle } = await import("./launch-lifecycle");

  const feeCalls: Array<{ totalFeeSol: number; referenceId: string }> = [];
  let finalStatus: string | null = null;

  const lifecycle = createLaunchLifecycle(
    baseDeps({
      resolvePlatform: () =>
        createFakePlatform({
          execute: async () => ({
            kind: "succeeded",
            usageFeeTotalSol: 0.25,
            userId: "user-1",
            tokenPublicKey: "Token1111111111111111111111111111111111111",
            referenceId: "launch-1",
          }),
        }),
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
    })
  );

  await lifecycle.runPlatformExecution("launch-1");

  assert.deepEqual(feeCalls, [{ totalFeeSol: 0.25, referenceId: "launch-1" }]);
  assert.equal(finalStatus, "SUCCEEDED");
});

test("lifecycle does not downgrade success when usage fee collection fails", async () => {
  stubServerOnlyModule();
  const { createLaunchLifecycle } = await import("./launch-lifecycle");

  let finalStatus: string | null = null;
  const warnings: string[] = [];

  const lifecycle = createLaunchLifecycle(
    baseDeps({
      resolvePlatform: () =>
        createFakePlatform({
          execute: async () => ({
            kind: "succeeded",
            usageFeeTotalSol: 0.25,
            userId: "user-1",
            tokenPublicKey: "Token1111111111111111111111111111111111111",
            referenceId: "launch-1",
          }),
        }),
      appendLog: async (_launchId, level, message) => {
        if (level === "WARN") {
          warnings.push(message);
        }
      },
      updateLaunchStatus: async (_launchId, status) => {
        finalStatus = status;
      },
      collectUsageFee: async () => {
        throw new Error("collector unavailable");
      },
    })
  );

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

  const lifecycle = createLaunchLifecycle(
    baseDeps({
      resolvePlatform: () =>
        createFakePlatform({
          execute: async () => ({
            kind: "failed",
            errorMessage: "RPC timeout",
          }),
        }),
      updateLaunchStatus: async (_launchId, status) => {
        finalStatus = status;
      },
      collectUsageFee: async () => {
        feeCalled = true;
        throw new Error("should not collect");
      },
    })
  );

  await lifecycle.runPlatformExecution("launch-1");

  assert.equal(feeCalled, false);
  assert.equal(finalStatus, "FAILED");
});

test("lifecycle maps partial and indeterminate outcomes to FAILED with outcomeKind", async () => {
  stubServerOnlyModule();
  const { createLaunchLifecycle } = await import("./launch-lifecycle");

  for (const kind of ["partial", "indeterminate"] as const) {
    let finalStatus: string | null = null;
    let outcomeKind: string | null = null;
    let feeCalled = false;

    const lifecycle = createLaunchLifecycle(
      baseDeps({
        loadLaunch: async () => ({
          id: "launch-1",
          userId: "user-1",
          platform: "PUMPFUN",
          status: "PENDING",
          plan: { ok: true },
          planSchemaVersion: "1",
          planPersistedAt: new Date("2026-01-01T00:00:00.000Z"),
          input: sampleInput,
        }),
        resolvePlatform: () =>
          createFakePlatform({
            execute: async () => ({
              kind,
              errorMessage: `${kind} evidence`,
              tokenPublicKey: "Token1111111111111111111111111111111111111",
            }),
          }),
        updateLaunchStatus: async (_launchId, status, _message, outcome) => {
          finalStatus = status;
          outcomeKind = outcome?.kind ?? null;
        },
        collectUsageFee: async () => {
          feeCalled = true;
          throw new Error("should not collect");
        },
      })
    );

    await lifecycle.runPlatformExecution("launch-1");

    assert.equal(finalStatus, "FAILED");
    assert.equal(outcomeKind, kind);
    assert.equal(feeCalled, false);
  }
});

test("lifecycle persists succeeded outcomeKind after fee collection", async () => {
  stubServerOnlyModule();
  const { createLaunchLifecycle } = await import("./launch-lifecycle");

  let finalStatus: string | null = null;
  let outcomeKind: string | null = null;

  const lifecycle = createLaunchLifecycle(
    baseDeps({
      loadLaunch: async () => ({
        id: "launch-1",
        userId: "user-1",
        platform: "PUMPFUN",
        status: "PENDING",
        plan: { ok: true },
        planSchemaVersion: "1",
        planPersistedAt: new Date("2026-01-01T00:00:00.000Z"),
        input: sampleInput,
      }),
      resolvePlatform: () =>
        createFakePlatform({
          execute: async () => ({
            kind: "succeeded",
            usageFeeTotalSol: 0,
            userId: "user-1",
            tokenPublicKey: "Token1111111111111111111111111111111111111",
            referenceId: "launch-1",
          }),
        }),
      updateLaunchStatus: async (_launchId, status, _message, outcome) => {
        finalStatus = status;
        outcomeKind = outcome?.kind ?? null;
      },
    })
  );

  await lifecycle.runPlatformExecution("launch-1");

  assert.equal(finalStatus, "SUCCEEDED");
  assert.equal(outcomeKind, "succeeded");
});
