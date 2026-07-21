import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import { LAUNCH_PLAN_SHELL_VERSION_V1 } from "@/server/schemas/launch-platform.schema";
import type {
  LaunchPlanEnvelopeV1,
  PumpfunLaunchPlanV1,
} from "@/server/schemas/launch-platform.schema";

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
  userId?: string;
}) {
  return {
    launchId: overrides.launchId ?? "launch-1",
    userId: overrides.userId ?? "user-1",
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

async function buildSamplePlan(): Promise<LaunchPlanEnvelopeV1> {
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
    bundlerBuyLamportsByWallet: [],
    jitoTipLamports: "0",
    mainReserveLamports: "0",
    intendedEffects: {
      bundleBuyEnabled: false,
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
      reservedVanityMintId: null,
      reservedVanityMintPublicKey: null,
    },
    money: platformPlan.money,
    platformPlan,
  });
}

test("platform recover validates persisted plan and reclaims from durable state", async () => {
  stubServerOnlyModule();
  const { runPumpfunRecover } = await import(
    "./launch-platform-pumpfun-recover"
  );

  const plan = await buildSamplePlan();
  let reclaimArgs: {
    launchId: string;
    userId: string;
    walletPublicKeys?: string[];
  } | null = null;

  const result = await runPumpfunRecover(
    lifecycleCtx({
      plan,
      planSchemaVersion: LAUNCH_PLAN_SHELL_VERSION_V1,
      launchId: "launch-recover",
      userId: "user-recover",
    }),
    { walletPublicKeys: ["Dev222222222222222222222222222222222222222"] },
    {
      reclaimFromPersistedState: async (launchId, userId, walletPublicKeys) => {
        reclaimArgs = { launchId, userId, walletPublicKeys };
        return {
          mainWalletPublicKey: "Main111111111111111111111111111111111111111",
          results: [
            {
              publicKey: "Dev222222222222222222222222222222222222222",
              status: "returned",
              amountSol: 0.1,
            },
          ],
        };
      },
    }
  );

  assert.deepEqual(reclaimArgs, {
    launchId: "launch-recover",
    userId: "user-recover",
    walletPublicKeys: ["Dev222222222222222222222222222222222222222"],
  });
  assert.equal(result.results[0]?.status, "returned");
  assert.equal(result.results[0]?.amountSol, 0.1);
});

test("platform recover rejects invalid persisted plan before reclaim", async () => {
  stubServerOnlyModule();
  const { isAppError } = await import("@/server/errors");
  const { runPumpfunRecover } = await import(
    "./launch-platform-pumpfun-recover"
  );

  let reclaimCalled = false;
  await assert.rejects(
    () =>
      runPumpfunRecover(
        lifecycleCtx({
          plan: { not: "valid" },
          planSchemaVersion: LAUNCH_PLAN_SHELL_VERSION_V1,
        }),
        undefined,
        {
          reclaimFromPersistedState: async () => {
            reclaimCalled = true;
            return { mainWalletPublicKey: "Main", results: [] };
          },
        }
      ),
    (error: unknown) => isAppError(error) && error.statusCode === 400
  );
  assert.equal(reclaimCalled, false);
});

test("platform recover without plan still reclaims using funded-cap helper path", async () => {
  stubServerOnlyModule();
  const { runPumpfunRecover } = await import(
    "./launch-platform-pumpfun-recover"
  );

  const result = await runPumpfunRecover(lifecycleCtx({}), undefined, {
    reclaimFromPersistedState: async () => ({
      mainWalletPublicKey: "Main111111111111111111111111111111111111111",
      results: [
        {
          publicKey: "Dev222222222222222222222222222222222222222",
          status: "skipped",
          error: "Zero balance",
        },
      ],
    }),
  });

  assert.equal(result.results[0]?.status, "skipped");
});
