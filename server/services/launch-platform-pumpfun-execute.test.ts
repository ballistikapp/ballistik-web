import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import { LAUNCH_PLAN_SHELL_VERSION_V1 } from "@/server/schemas/launch-platform.schema";
import type { LaunchPlanEnvelopeV1, PumpfunLaunchPlanV1 } from "@/server/schemas/launch-platform.schema";

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

function lifecycleCtx(overrides: {
  plan?: unknown;
  planSchemaVersion?: string | null;
  launchId?: string;
}) {
  return {
    launchId: overrides.launchId ?? "launch-1",
    userId: "user-1",
    plan: overrides.plan ?? null,
    planSchemaVersion:
      overrides.planSchemaVersion === undefined
        ? null
        : overrides.planSchemaVersion,
    reportProgress: async () => undefined,
    appendLog: async () => undefined,
    isCancelRequested: async () => false,
  };
}

async function buildSamplePlan(
  bundleBuyEnabled: boolean
): Promise<LaunchPlanEnvelopeV1> {
  stubServerOnlyModule();
  const { assemblePumpfunLaunchPlan } = await import(
    "./launch-platform-pumpfun-plan"
  );
  const { assembleLaunchPlanEnvelope } = await import("./launch-plan-envelope");

  const platformPlan = assemblePumpfunLaunchPlan({
    money: {
      immediateRequiredBalanceLamports: "500000000",
      temporaryFundingLamports: "200000000",
      permanentSpendLamports: "300000000",
      expectedReturnLamports: "200000000",
      expectedMainWalletDeltaNowLamports: "-500000000",
      expectedMainWalletDeltaAfterCleanupLamports: "-300000000",
      usageFeeLamports: "0",
      lineItems: [{ label: "Dev buy", amountLamports: "100000000" }],
    },
    mainWalletPublicKey: "Main111111111111111111111111111111111111111",
    creatorWalletPublicKey: "Dev222222222222222222222222222222222222222",
    creatorWalletOption: "generate",
    managedWallets: [
      {
        publicKey: "Dev222222222222222222222222222222222222222",
        platformRole: "creator",
        isManaged: true,
        fundedCapLamports: "250000000",
      },
    ],
    creatorBuyLamports: "100000000",
    bundlerBuyLamportsByWallet: bundleBuyEnabled
      ? [
          {
            publicKey: "Bund333333333333333333333333333333333333333",
            amountLamports: "50000000",
          },
        ]
      : [],
    jitoTipLamports: bundleBuyEnabled ? "1000000" : "0",
    mainReserveLamports: "0",
    intendedEffects: {
      bundleBuyEnabled,
      mayhemMode: false,

      distributionWalletMultiplier: 1,
    },

    bundlerBuyAllocationUsedFallback: false,
    platformFeeWaived: false,
    platformFeeDiscountRate: 0,
    hasSufficientMainWallet: true,
    mainWalletBalanceLamports: "5000000000",
  });

  return assembleLaunchPlanEnvelope({
    optionsOutcomes: {
      vanityMint: false,
      removeAttribution: false,
      mintPublicKey: "Mint111111111111111111111111111111111111111",
      plannedMintId: "planned-mint-1",
      reservedVanityMintId: null,
    },
    money: platformPlan.money,
    platformPlan,
  });
}

test("requirePumpfunExecutePlan rejects missing plan", async () => {
  stubServerOnlyModule();
  const { isAppError } = await import("@/server/errors");
  const { requirePumpfunExecutePlan } = await import(
    "./launch-platform-pumpfun-execute"
  );

  assert.throws(
    () => requirePumpfunExecutePlan(lifecycleCtx({})),
    (error: unknown) =>
      isAppError(error) &&
      error.statusCode === 500 &&
      /plan is required/i.test(error.message)
  );
});

test("requirePumpfunExecutePlan rejects invalid plan payload", async () => {
  stubServerOnlyModule();
  const { isAppError } = await import("@/server/errors");
  const { requirePumpfunExecutePlan } = await import(
    "./launch-platform-pumpfun-execute"
  );

  assert.throws(
    () =>
      requirePumpfunExecutePlan(
        lifecycleCtx({
          plan: { not: "a plan" },
          planSchemaVersion: LAUNCH_PLAN_SHELL_VERSION_V1,
        })
      ),
    (error: unknown) => isAppError(error) && error.statusCode === 500
  );
});

test("assertNonSystemCreatorWalletOption rejects system creator", async () => {
  stubServerOnlyModule();
  const { isAppError } = await import("@/server/errors");
  const { assertNonSystemCreatorWalletOption } = await import(
    "./launch-platform-pumpfun-execute"
  );

  assert.throws(
    () => assertNonSystemCreatorWalletOption("system"),
    (error: unknown) =>
      isAppError(error) &&
      error.statusCode === 400 &&
      /platform dev wallet/i.test(error.message)
  );
});

test("runPumpfunNonBundledExecute rejects bundled plans and runs job for non-bundled", async () => {
  stubServerOnlyModule();
  const { isAppError } = await import("@/server/errors");
  const { runPumpfunNonBundledExecute } = await import(
    "./launch-platform-pumpfun-execute"
  );

  const bundled = await buildSamplePlan(true);
  await assert.rejects(
    () =>
      runPumpfunNonBundledExecute(
        lifecycleCtx({
          plan: bundled,
          planSchemaVersion: LAUNCH_PLAN_SHELL_VERSION_V1,
        }),
        {
          runNonBundledJob: async () => {
            throw new Error("should not run for bundled plan");
          },
        }
      ),
    (error: unknown) => isAppError(error) && error.statusCode === 500
  );

  const nonBundled = await buildSamplePlan(false);
  let ran = false;
  const result = await runPumpfunNonBundledExecute(
    lifecycleCtx({
      plan: nonBundled,
      planSchemaVersion: LAUNCH_PLAN_SHELL_VERSION_V1,
      launchId: "launch-non-bundled",
    }),
    {
      runNonBundledJob: async (launchId) => {
        assert.equal(launchId, "launch-non-bundled");
        ran = true;
        return { kind: "canceled" };
      },
    }
  );
  assert.equal(ran, true);
  assert.equal(result.kind, "canceled");
});

test("runPumpfunBundledExecute rejects non-bundled plans and runs job for bundled", async () => {
  stubServerOnlyModule();
  const { isAppError } = await import("@/server/errors");
  const { runPumpfunBundledExecute } = await import(
    "./launch-platform-pumpfun-execute"
  );

  const nonBundled = await buildSamplePlan(false);
  await assert.rejects(
    () =>
      runPumpfunBundledExecute(
        lifecycleCtx({
          plan: nonBundled,
          planSchemaVersion: LAUNCH_PLAN_SHELL_VERSION_V1,
        }),
        {
          runBundledJob: async () => {
            throw new Error("should not run for non-bundled plan");
          },
        }
      ),
    (error: unknown) => isAppError(error) && error.statusCode === 500
  );

  const bundled = await buildSamplePlan(true);
  let ran = false;
  const result = await runPumpfunBundledExecute(
    lifecycleCtx({
      plan: bundled,
      planSchemaVersion: LAUNCH_PLAN_SHELL_VERSION_V1,
      launchId: "launch-bundled",
    }),
    {
      runBundledJob: async (launchId) => {
        assert.equal(launchId, "launch-bundled");
        ran = true;
        return {
          kind: "succeeded",
          usageFeeTotalSol: 0,
          userId: "user-1",
          tokenPublicKey: "Token1111111111111111111111111111111111111",
          referenceId: launchId,
        };
      },
    }
  );
  assert.equal(ran, true);
  assert.equal(result.kind, "succeeded");
});

test("platform execute routes typed job outcomes without compat", async () => {
  stubServerOnlyModule();
  const { createPumpfunPlatformModule } = await import(
    "./launch-platform-pumpfun"
  );

  const calls: string[] = [];
  const platform = createPumpfunPlatformModule({
    runBundledExecute: async (ctx) => {
      calls.push(`bundled:${ctx.launchId}`);
      return { kind: "canceled" };
    },
    runNonBundledExecute: async (ctx) => {
      calls.push(`non_bundled:${ctx.launchId}`);
      return {
        kind: "succeeded",
        usageFeeTotalSol: 0,
        userId: "user-1",
        tokenPublicKey: "Token1111111111111111111111111111111111111",
        referenceId: ctx.launchId,
      };
    },
  });

  const nonBundled = await buildSamplePlan(false);
  const nonBundledResult = await platform.execute(
    lifecycleCtx({
      plan: nonBundled,
      planSchemaVersion: LAUNCH_PLAN_SHELL_VERSION_V1,
      launchId: "nb-1",
    })
  );
  assert.equal(nonBundledResult.kind, "succeeded");

  const bundled = await buildSamplePlan(true);
  const bundledResult = await platform.execute(
    lifecycleCtx({
      plan: bundled,
      planSchemaVersion: LAUNCH_PLAN_SHELL_VERSION_V1,
      launchId: "b-1",
    })
  );
  assert.equal(bundledResult.kind, "canceled");

  assert.deepEqual(calls, ["non_bundled:nb-1", "bundled:b-1"]);
});

test("platform execute maps cancel-before-submit and post-confirm degraded success", async () => {
  stubServerOnlyModule();
  const { createPumpfunPlatformModule } = await import(
    "./launch-platform-pumpfun"
  );

  const canceledPlatform = createPumpfunPlatformModule({
    runNonBundledExecute: async () => ({ kind: "canceled" }),
  });
  const canceled = await canceledPlatform.execute(
    lifecycleCtx({
      plan: await buildSamplePlan(false),
      planSchemaVersion: LAUNCH_PLAN_SHELL_VERSION_V1,
    })
  );
  assert.equal(canceled.kind, "canceled");

  const succeededPlatform = createPumpfunPlatformModule({
    runNonBundledExecute: async () => ({
      kind: "succeeded",
      usageFeeTotalSol: 0.1,
      userId: "user-1",
      tokenPublicKey: "Token1111111111111111111111111111111111111",
      referenceId: "launch-1",
      details: {
        cancelRequestedAfterIrreversibleSubmit: true,
        postConfirmDegraded: true,
      },
    }),
  });
  const succeeded = await succeededPlatform.execute(
    lifecycleCtx({
      plan: await buildSamplePlan(false),
      planSchemaVersion: LAUNCH_PLAN_SHELL_VERSION_V1,
    })
  );
  assert.equal(succeeded.kind, "succeeded");
  if (succeeded.kind === "succeeded") {
    assert.equal(succeeded.details?.cancelRequestedAfterIrreversibleSubmit, true);
    assert.equal(succeeded.details?.postConfirmDegraded, true);
  }

  const indeterminatePlatform = createPumpfunPlatformModule({
    runNonBundledExecute: async () => ({
      kind: "indeterminate",
      errorMessage: "Confirmation timed out after submit",
      tokenPublicKey: "Token1111111111111111111111111111111111111",
    }),
  });
  const indeterminate = await indeterminatePlatform.execute(
    lifecycleCtx({
      plan: await buildSamplePlan(false),
      planSchemaVersion: LAUNCH_PLAN_SHELL_VERSION_V1,
    })
  );
  assert.equal(indeterminate.kind, "indeterminate");

  const partialPlatform = createPumpfunPlatformModule({
    runNonBundledExecute: async () => ({
      kind: "partial",
      errorMessage: "Mint landed but intended buy path incomplete",
      tokenPublicKey: "Token1111111111111111111111111111111111111",
    }),
  });
  const partial = await partialPlatform.execute(
    lifecycleCtx({
      plan: await buildSamplePlan(false),
      planSchemaVersion: LAUNCH_PLAN_SHELL_VERSION_V1,
    })
  );
  assert.equal(partial.kind, "partial");
});

test("platform execute fails without silent replan when plan is missing", async () => {
  stubServerOnlyModule();
  const { isAppError } = await import("@/server/errors");
  const { createPumpfunPlatformModule } = await import(
    "./launch-platform-pumpfun"
  );

  const platform = createPumpfunPlatformModule({
    runBundledExecute: async () => {
      throw new Error("bundled should not run");
    },
    runNonBundledExecute: async () => {
      throw new Error("non-bundled should not run");
    },
  });

  await assert.rejects(
    () => platform.execute(lifecycleCtx({})),
    (error: unknown) => isAppError(error) && error.statusCode === 500
  );
});
