import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import { PUMPFUN_PLAN_SCHEMA_VERSION_V1 } from "@/server/schemas/launch-platform.schema";
import type { PumpfunLaunchPlanV1 } from "@/server/schemas/launch-platform.schema";

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
): Promise<PumpfunLaunchPlanV1> {
  stubServerOnlyModule();
  const { assemblePumpfunLaunchPlan } = await import(
    "./launch-platform-pumpfun-plan"
  );

  return assemblePumpfunLaunchPlan({
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
      vanityMint: false,
      removeAttribution: false,
      distributionWalletMultiplier: 1,
    },
    reservedVanityMintId: null,
    reservedVanityMintPublicKey: null,
    bundlerBuyAllocationUsedFallback: false,
    platformFeeWaived: false,
    platformFeeDiscountRate: 0,
    hasSufficientMainWallet: true,
    mainWalletBalanceLamports: "5000000000",
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
          planSchemaVersion: PUMPFUN_PLAN_SCHEMA_VERSION_V1,
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
          planSchemaVersion: PUMPFUN_PLAN_SCHEMA_VERSION_V1,
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
  await runPumpfunNonBundledExecute(
    lifecycleCtx({
      plan: nonBundled,
      planSchemaVersion: PUMPFUN_PLAN_SCHEMA_VERSION_V1,
      launchId: "launch-non-bundled",
    }),
    {
      runNonBundledJob: async (launchId) => {
        assert.equal(launchId, "launch-non-bundled");
        ran = true;
      },
    }
  );
  assert.equal(ran, true);
});

test("platform execute routes non-bundled to Platform runner and bundled to compat", async () => {
  stubServerOnlyModule();
  const { createPumpfunPlatformModule } = await import(
    "./launch-platform-pumpfun"
  );

  const calls: string[] = [];
  const platform = createPumpfunPlatformModule({
    runBundledCompat: async (launchId) => {
      calls.push(`bundled:${launchId}`);
    },
    runNonBundledExecute: async (ctx) => {
      calls.push(`non_bundled:${ctx.launchId}`);
    },
  });

  const nonBundled = await buildSamplePlan(false);
  const nonBundledResult = await platform.execute(
    lifecycleCtx({
      plan: nonBundled,
      planSchemaVersion: PUMPFUN_PLAN_SCHEMA_VERSION_V1,
      launchId: "nb-1",
    })
  );
  assert.equal(nonBundledResult.kind, "compat");

  const bundled = await buildSamplePlan(true);
  const bundledResult = await platform.execute(
    lifecycleCtx({
      plan: bundled,
      planSchemaVersion: PUMPFUN_PLAN_SCHEMA_VERSION_V1,
      launchId: "b-1",
    })
  );
  assert.equal(bundledResult.kind, "compat");

  assert.deepEqual(calls, ["non_bundled:nb-1", "bundled:b-1"]);
});

test("platform execute fails without silent replan when plan is missing", async () => {
  stubServerOnlyModule();
  const { isAppError } = await import("@/server/errors");
  const { createPumpfunPlatformModule } = await import(
    "./launch-platform-pumpfun"
  );

  const platform = createPumpfunPlatformModule({
    runBundledCompat: async () => {
      throw new Error("compat should not run");
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
