import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import { PUMPFUN_MONEY_LINE_LABELS } from "@/lib/launch/money-labels";
import {
  LAUNCH_INPUT_SCHEMA_VERSION_V1,
  normalizedLaunchMoneySummarySchema,
  versionedLaunchPreviewInputSchema,
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

const previewInput = versionedLaunchPreviewInputSchema.parse({
  schemaVersion: LAUNCH_INPUT_SCHEMA_VERSION_V1,
  platform: "PUMPFUN",
  options: {
    vanityMint: false,
    removeAttribution: false,
  },
  config: {
    devWalletOption: "use_main",
    devBuyAmountSol: 0.1,
    jitoTipAmountSol: 0.001,
    bundleBuyEnabled: false,
    mayhemMode: false,
    bundlerWalletCount: 0,
    bundlerBuyAmountSol: 0.05,
    bundlerBuyVariancePercent: 0,
    distributionWalletMultiplier: 1,
  },
});

test("pump.fun preview returns normalized money and review envelope without writes", async () => {
  stubServerOnlyModule();
  const { createPumpfunPlatformModule } = await import(
    "./launch-platform-pumpfun"
  );

  let calculateCalls = 0;
  const platform = createPumpfunPlatformModule({
    calculateCostPreview: async () => {
      calculateCalls += 1;
      return {
        platformFeeWaived: false,
        platformFeeDiscountRate: 0,
        mainWalletBalanceSol: 2,
        mainWalletBalanceLamports: "2000000000",
        requiredMainWalletSol: 0.5,
        requiredMainWalletLamports: "500000000",
        hasSufficientMainWallet: true,
        chargedNowSol: 0.5,
        temporaryFundingSol: 0.3,
        expectedReturnSol: 0.2,
        permanentSpendSol: 0.3,
        netMainWalletDeltaNowSol: 0.5,
        netMainWalletDeltaAfterCleanupSol: 0.3,
        lineItems: {
          usageFeesSol: 0,
          descriptionAttributionRemovalFeeSol: 0,
          bundleBuyFeeSol: 0,
          vanityMintFeeSol: 0,
          generatedWalletCount: 0,
          generatedWalletsBilledForFeeCount: 0,
          generatedWalletFeeSol: 0,
          nonSystemDevWalletFeeSol: 0,
          devBuySol: 0.1,
          bundleBuyBaseSol: 0,
          bundleBuyMaxSol: 0,
          bundleBuyVarianceReserveSol: 0,
          creatorReserveSol: 0.05,
          jitoTipSol: 0,
          walletFundingTopUpSol: 0.3,
          mainReserveSol: 0.1,
          buyWalletReserveSol: 0,
          creatorTargetSol: 0.15,
          devFundingSol: 0,
          bundlerFundingPerWalletSol: 0,
          totalBundlerFundingSol: 0,
          transferReserveSol: 0.01,
          ataRentSol: 0.002,
          userVolumeAccumulatorRentSol: 0.001,
          buyRentPerWalletSol: 0.003,
          distributionAtaPerBundlerSol: 0,
          totalDistributionAtaSol: 0,
        },
      };
    },
  });

  const result = await platform.preview(previewInput, {
    user: { id: "user-1", plan: "FREE" },
  });

  assert.equal(calculateCalls, 1);
  assert.equal(result.hasSufficientMainWallet, true);
  assert.equal(result.mainWalletBalanceLamports, "2000000000");
  assert.equal(result.platformFeeWaived, false);
  assert.equal(result.platformFeeDiscountRate, 0);

  const money = normalizedLaunchMoneySummarySchema.parse(result.money);
  assert.equal(money.immediateRequiredBalanceLamports, "500000000");
  assert.equal(money.temporaryFundingLamports, "300000000");
  assert.equal(money.permanentSpendLamports, "300000000");
  assert.equal(money.expectedReturnLamports, "200000000");
  assert.equal(money.expectedMainWalletDeltaNowLamports, "-500000000");
  assert.equal(money.expectedMainWalletDeltaAfterCleanupLamports, "-300000000");
  assert.equal(money.usageFeeLamports, "0");
  assert.ok(
    money.lineItems.some(
      (item) =>
        item.label === PUMPFUN_MONEY_LINE_LABELS.devBuy &&
        item.amountLamports === "100000000"
    )
  );
  assert.ok(
    money.lineItems.some(
      (item) => item.label === PUMPFUN_MONEY_LINE_LABELS.creatorReserve
    )
  );
});

test("pump.fun plan returns injected authoritative plan without secrets", async () => {
  stubServerOnlyModule();
  const { createPumpfunPlatformModule } = await import(
    "./launch-platform-pumpfun"
  );
  const { planPayloadContainsSecretMaterial } = await import(
    "./launch-platform-pumpfun-plan"
  );

  const planned = {
    schemaVersion: "1",
    platform: "PUMPFUN",
    money: {
      immediateRequiredBalanceLamports: "1",
      temporaryFundingLamports: "0",
      permanentSpendLamports: "1",
      expectedReturnLamports: "0",
      expectedMainWalletDeltaNowLamports: "-1",
      expectedMainWalletDeltaAfterCleanupLamports: "-1",
      usageFeeLamports: "0",
      lineItems: [],
    },
  };

  const platform = createPumpfunPlatformModule({
    buildPlan: async () => ({
      kind: "planned",
      planSchemaVersion: "1",
      plan: planned,
      localResources: {
        reservedVanityMintId: null,
        createdWalletPublicKeys: [],
      },
    }),
  });

  const result = await platform.plan(
    {
      launchId: "launch-1",
      userId: "user-1",
      plan: null,
      planSchemaVersion: null,
      reportProgress: async () => undefined,
      appendLog: async () => undefined,
      isCancelRequested: async () => false,
    },
    {
      schemaVersion: LAUNCH_INPUT_SCHEMA_VERSION_V1,
      platform: "PUMPFUN",
      metadata: {
        tokenName: "Test",
        tokenSymbol: "TST",
        tokenImage: "https://example.com/a.png",
      },
      options: previewInput.options,
      config: previewInput.config,
    }
  );

  assert.equal(result.kind, "planned");
  if (result.kind === "planned") {
    assert.deepEqual(result.plan, planned);
    assert.equal(planPayloadContainsSecretMaterial(result.plan), false);
  }
});

test("pump.fun plan surfaces insufficient-funds as a failed plan outcome", async () => {
  stubServerOnlyModule();
  const { createPumpfunPlatformModule } = await import(
    "./launch-platform-pumpfun"
  );

  const platform = createPumpfunPlatformModule({
    buildPlan: async () => ({
      kind: "failed",
      errorMessage:
        "Main wallet requires 1.2500 SOL to fund launch wallets and usage fees",
    }),
  });

  const result = await platform.plan(
    {
      launchId: "launch-1",
      userId: "user-1",
      plan: null,
      planSchemaVersion: null,
      reportProgress: async () => undefined,
      appendLog: async () => undefined,
      isCancelRequested: async () => false,
    },
    {
      schemaVersion: LAUNCH_INPUT_SCHEMA_VERSION_V1,
      platform: "PUMPFUN",
      metadata: {
        tokenName: "Test",
        tokenSymbol: "TST",
        tokenImage: "https://example.com/a.png",
      },
      options: previewInput.options,
      config: previewInput.config,
    }
  );

  assert.equal(result.kind, "failed");
  if (result.kind === "failed") {
    assert.match(result.errorMessage, /Main wallet requires/i);
  }
});

test("pump.fun preview rejects invalid configuration with a user-safe error", async () => {
  stubServerOnlyModule();
  const { isAppError } = await import("@/server/errors");
  const { createPumpfunPlatformModule } = await import(
    "./launch-platform-pumpfun"
  );

  const platform = createPumpfunPlatformModule({
    calculateCostPreview: async () => {
      throw new Error("calculator should not run for invalid input");
    },
  });

  await assert.rejects(
    () =>
      platform.preview(
        {
          schemaVersion: LAUNCH_INPUT_SCHEMA_VERSION_V1,
          platform: "PUMPFUN",
          options: previewInput.options,
          config: {
            ...previewInput.config,
            bundlerWalletCount: 99,
          },
        },
        { user: { id: "user-1", plan: "FREE" } }
      ),
    (error: unknown) => isAppError(error) && error.statusCode === 400
  );
});
