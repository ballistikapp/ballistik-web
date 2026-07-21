import type {
  LaunchPlanEnvelopeV1,
  PumpfunLaunchPlanV1,
} from "@/server/schemas/launch-platform.schema";

/** Minimal valid pump.fun platform plan for unit tests. */
export function samplePumpfunPlatformPlan(
  overrides: Partial<{
    bundleBuyEnabled: boolean;
    mainWalletBalanceLamports: string;
    immediateRequiredBalanceLamports: string;
  }> = {}
): PumpfunLaunchPlanV1 {
  const bundleBuyEnabled = overrides.bundleBuyEnabled ?? false;
  return {
    schemaVersion: "1",
    platform: "PUMPFUN",
    money: {
      immediateRequiredBalanceLamports:
        overrides.immediateRequiredBalanceLamports ?? "500000000",
      temporaryFundingLamports: "200000000",
      permanentSpendLamports: "300000000",
      expectedReturnLamports: "200000000",
      expectedMainWalletDeltaNowLamports: "-500000000",
      expectedMainWalletDeltaAfterCleanupLamports: "-300000000",
      usageFeeLamports: "0",
      lineItems: [{ label: "Dev buy", amountLamports: "100000000" }],
    },
    wallets: {
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
    },
    allocations: {
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
    },
    intendedEffects: {
      bundleBuyEnabled,
      mayhemMode: false,
      distributionWalletMultiplier: 1,
    },
    recovery: {
      policy: "plan_funded_cap",
      capsByWalletPublicKey: {
        Dev222222222222222222222222222222222222222: "250000000",
      },
    },
    opaque: {
      bundlerBuyAllocationUsedFallback: false,
      platformFeeWaived: false,
      platformFeeDiscountRate: 0,
      hasSufficientMainWallet: true,
      mainWalletBalanceLamports:
        overrides.mainWalletBalanceLamports ?? "5000000000",
    },
  };
}

export function sampleLaunchPlanEnvelope(
  platformPlan: PumpfunLaunchPlanV1 = samplePumpfunPlatformPlan()
): LaunchPlanEnvelopeV1 {
  return {
    shellVersion: "1",
    optionsOutcomes: {
      vanityMint: false,
      removeAttribution: false,
      reservedVanityMintId: null,
      reservedVanityMintPublicKey: null,
    },
    platformPlan,
  };
}
