import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
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

async function buildSamplePlan(): Promise<PumpfunLaunchPlanV1> {
  stubServerOnlyModule();
  const { assemblePumpfunLaunchPlan } = await import(
    "./launch-platform-pumpfun-plan"
  );

  return assemblePumpfunLaunchPlan({
    money: {
      immediateRequiredBalanceLamports: "2500000000",
      temporaryFundingLamports: "2000000000",
      permanentSpendLamports: "500000000",
      expectedReturnLamports: "2000000000",
      expectedMainWalletDeltaNowLamports: "-2500000000",
      expectedMainWalletDeltaAfterCleanupLamports: "-500000000",
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
      {
        publicKey: "Bund333333333333333333333333333333333333333",
        platformRole: "bundler",
        isManaged: true,
        fundedCapLamports: "180000000",
      },
      {
        publicKey: "Dist444444444444444444444444444444444444444",
        platformRole: "distribution",
        isManaged: true,
        fundedCapLamports: "0",
      },
    ],
    creatorBuyLamports: "100000000",
    bundlerBuyLamportsByWallet: [
      {
        publicKey: "Bund333333333333333333333333333333333333333",
        amountLamports: "100000000",
      },
    ],
    jitoTipLamports: "10000000",
    mainReserveLamports: "15000000",
    intendedEffects: {
      bundleBuyEnabled: true,
      mayhemMode: false,
      vanityMint: false,
      removeAttribution: false,
      distributionWalletMultiplier: 2,
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

test("buildFundingTargetsFromPumpfunPlan uses plan caps and main reserve", async () => {
  stubServerOnlyModule();
  const { buildFundingTargetsFromPumpfunPlan } = await import(
    "./launch-platform-pumpfun-funding"
  );

  const plan = await buildSamplePlan();
  const funding = buildFundingTargetsFromPumpfunPlan(plan);

  assert.equal(funding.mainReserveLamports, BigInt("15000000"));
  assert.equal(funding.tipLamports, BigInt("10000000"));
  assert.deepEqual(
    funding.fundingTargets.map((target) => ({
      publicKey: target.publicKey,
      requiredLamports: target.requiredLamports.toString(),
    })),
    [
      {
        publicKey: "Dev222222222222222222222222222222222222222",
        requiredLamports: "250000000",
      },
      {
        publicKey: "Bund333333333333333333333333333333333333333",
        requiredLamports: "180000000",
      },
    ]
  );
});

test("buildManagedLaunchWalletRowsFromPumpfunPlan tracks plan identities and roles", async () => {
  stubServerOnlyModule();
  const { buildManagedLaunchWalletRowsFromPumpfunPlan } = await import(
    "./launch-platform-pumpfun-funding"
  );

  const plan = await buildSamplePlan();
  const rows = buildManagedLaunchWalletRowsFromPumpfunPlan("launch-1", plan);

  assert.deepEqual(rows, [
    {
      launchId: "launch-1",
      walletPublicKey: "Dev222222222222222222222222222222222222222",
      walletType: "DEV",
      role: "DEV",
      platformRole: "creator",
      isManaged: true,
    },
    {
      launchId: "launch-1",
      walletPublicKey: "Bund333333333333333333333333333333333333333",
      walletType: "BUNDLER",
      role: "BUNDLER",
      platformRole: "bundler",
      isManaged: true,
    },
    {
      launchId: "launch-1",
      walletPublicKey: "Dist444444444444444444444444444444444444444",
      walletType: "DISTRIBUTION",
      role: "DISTRIBUTION",
      platformRole: "distribution",
      isManaged: true,
    },
  ]);
  assert.ok(
    !JSON.stringify(rows).includes("privateKey"),
    "MLW rows must not include secret material"
  );
});

test("launchUsesPlanFundedCapRecovery detects plan recovery policy", async () => {
  stubServerOnlyModule();
  const { launchUsesPlanFundedCapRecovery } = await import(
    "./launch-platform-pumpfun-funding"
  );

  const plan = await buildSamplePlan();
  assert.equal(launchUsesPlanFundedCapRecovery(plan), true);
  assert.equal(launchUsesPlanFundedCapRecovery(null), false);
  assert.equal(launchUsesPlanFundedCapRecovery({ recovery: { policy: "other" } }), false);
});
