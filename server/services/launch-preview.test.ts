import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import {
  LAUNCH_INPUT_SCHEMA_VERSION_V1,
  launchPlatformPreviewResultSchema,
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

test("previewCosts routes through Platform preview and returns the review envelope", async () => {
  stubServerOnlyModule();
  const { createPumpfunPlatformModule } = await import(
    "./launch-platform-pumpfun"
  );
  const { __setLaunchPlatformRegistryForTests } = await import(
    "./launch-platform-registry"
  );
  const { launchService } = await import("./launch.service");

  __setLaunchPlatformRegistryForTests({
    PUMPFUN: createPumpfunPlatformModule({
      calculateCostPreview: async () => ({
        platformFeeWaived: true,
        platformFeeDiscountRate: 1,
        mainWalletBalanceSol: 5,
        mainWalletBalanceLamports: "5000000000",
        requiredMainWalletSol: 1,
        requiredMainWalletLamports: "1000000000",
        hasSufficientMainWallet: true,
        chargedNowSol: 1,
        temporaryFundingSol: 0.4,
        expectedReturnSol: 0.25,
        permanentSpendSol: 0.75,
        netMainWalletDeltaNowSol: 1,
        netMainWalletDeltaAfterCleanupSol: 0.75,
        lineItems: {
          usageFeesSol: 0,
          descriptionAttributionRemovalFeeSol: 0,
          bundleBuyFeeSol: 0,
          vanityMintFeeSol: 0,
          generatedWalletCount: 0,
          generatedWalletsBilledForFeeCount: 0,
          generatedWalletFeeSol: 0,
          nonSystemDevWalletFeeSol: 0,
          devBuySol: 0.5,
          bundleBuyBaseSol: 0,
          bundleBuyMaxSol: 0,
          bundleBuyVarianceReserveSol: 0,
          creatorReserveSol: 0.1,
          jitoTipSol: 0,
          walletFundingTopUpSol: 0.4,
          mainReserveSol: 0.5,
          buyWalletReserveSol: 0,
          creatorTargetSol: 0.6,
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
      }),
    }),
  });

  try {
    const input = versionedLaunchPreviewInputSchema.parse({
      schemaVersion: LAUNCH_INPUT_SCHEMA_VERSION_V1,
      platform: "PUMPFUN",
      config: {
        devWalletOption: "generate",
        devBuyAmountSol: 0.5,
        jitoTipAmountSol: 0,
        bundleBuyEnabled: false,
        vanityMint: false,
        removeAttribution: false,
        mayhemMode: false,
        bundlerWalletCount: 0,
        bundlerBuyAmountSol: 0.05,
        bundlerBuyVariancePercent: 0,
        distributionWalletMultiplier: 1,
      },
    });

    const result = await launchService.previewCosts(input, {
      id: "user-1",
      plan: "PRO",
    });

    const parsed = launchPlatformPreviewResultSchema.parse(result);
    assert.equal(parsed.platformFeeWaived, true);
    assert.equal(parsed.hasSufficientMainWallet, true);
    assert.equal(parsed.money.immediateRequiredBalanceLamports, "1000000000");
    assert.equal(parsed.money.usageFeeLamports, "0");
  } finally {
    __setLaunchPlatformRegistryForTests(null);
  }
});
