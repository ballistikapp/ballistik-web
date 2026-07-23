import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_BUNDLE_WALLETS,
  MIN_BUY_AMOUNT_SOL,
} from "@/lib/config/launch.config";
import {
  isLegacyPlatformRecord,
  launchPlanEnvelopeV1Schema,
  normalizedLaunchMoneySummarySchema,
  pumpfunLaunchPlanV1Schema,
  versionedLaunchInputSchema,
  versionedLaunchPreviewInputSchema,
} from "./launch-platform.schema";

const validPumpfunInput = {
  schemaVersion: 1 as const,
  platform: "PUMPFUN" as const,
  metadata: {
    tokenName: "Test Token",
    tokenSymbol: "TEST",
    tokenImage: "https://example.com/image.png",
    description: "A test token",
    twitter: "https://x.com/test",
    telegram: "https://t.me/test",
    website: "https://example.com",
  },
  options: {
    vanityMint: false,
    removeAttribution: false,
  },
  config: {
    devWalletOption: "use_main" as const,
    devBuyAmountSol: 0.1,
    jitoTipAmountSol: 0.001,
    bundleBuyEnabled: false,
    mayhemMode: false,
    bundlerWalletCount: 0,
    bundlerBuyAmountSol: 0.05,
    bundlerBuyVariancePercent: 0,
    distributionWalletMultiplier: 1,
  },
};

test("versioned launch input accepts pump.fun branch with shared metadata", () => {
  const parsed = versionedLaunchInputSchema.parse(validPumpfunInput);
  assert.equal(parsed.platform, "PUMPFUN");
  assert.equal(parsed.schemaVersion, 1);
  assert.equal(parsed.metadata.tokenName, "Test Token");
  assert.equal(parsed.options.vanityMint, false);
  assert.equal(parsed.options.removeAttribution, false);
  assert.equal(parsed.config.devWalletOption, "use_main");
});

test("versioned launch input keeps Launch Options out of pump.fun config", () => {
  const result = versionedLaunchInputSchema.safeParse({
    ...validPumpfunInput,
    config: {
      ...validPumpfunInput.config,
      vanityMint: true,
      removeAttribution: true,
    },
  });
  assert.equal(result.success, false);
});

test("versioned launch input requires Launch Options", () => {
  const { options: _options, ...withoutOptions } = validPumpfunInput;
  const result = versionedLaunchInputSchema.safeParse(withoutOptions);
  assert.equal(result.success, false);
});

test("versioned launch preview input includes Launch Options without metadata", () => {
  const parsed = versionedLaunchPreviewInputSchema.parse({
    schemaVersion: 1,
    platform: "PUMPFUN",
    options: { vanityMint: true, removeAttribution: true },
    config: validPumpfunInput.config,
  });
  assert.equal(parsed.options.vanityMint, true);
  assert.equal(parsed.options.removeAttribution, true);
  assert.equal("metadata" in parsed, false);
});

test("versioned launch preview input requires Launch Options", () => {
  const result = versionedLaunchPreviewInputSchema.safeParse({
    schemaVersion: 1,
    platform: "PUMPFUN",
    config: validPumpfunInput.config,
  });
  assert.equal(result.success, false);
});

test("versioned launch input rejects SPL as a persisted execution Platform", () => {
  const result = versionedLaunchInputSchema.safeParse({
    ...validPumpfunInput,
    platform: "SPL",
  });
  assert.equal(result.success, false);
});

test("versioned launch input rejects EVM as a persisted execution Platform", () => {
  const result = versionedLaunchInputSchema.safeParse({
    ...validPumpfunInput,
    platform: "EVM",
  });
  assert.equal(result.success, false);
});

test("versioned launch input requires pump.fun config only on the pump branch", () => {
  const { config: _config, ...withoutConfig } = validPumpfunInput;
  const result = versionedLaunchInputSchema.safeParse(withoutConfig);
  assert.equal(result.success, false);
});

test("versioned launch input rejects system creator Wallet option", () => {
  const result = versionedLaunchInputSchema.safeParse({
    ...validPumpfunInput,
    config: {
      ...validPumpfunInput.config,
      devWalletOption: "system",
    },
  });
  assert.equal(result.success, false);
});

test("versioned launch config buy and bundle limits match launch.config", () => {
  const overBundle = versionedLaunchInputSchema.safeParse({
    ...validPumpfunInput,
    config: {
      ...validPumpfunInput.config,
      bundlerWalletCount: MAX_BUNDLE_WALLETS + 1,
    },
  });
  assert.equal(overBundle.success, false);

  const underMinBuy = versionedLaunchInputSchema.safeParse({
    ...validPumpfunInput,
    config: {
      ...validPumpfunInput.config,
      devBuyAmountSol: MIN_BUY_AMOUNT_SOL - 0.001,
      bundlerBuyAmountSol: MIN_BUY_AMOUNT_SOL - 0.001,
    },
  });
  assert.equal(underMinBuy.success, false);

  const atLimits = versionedLaunchInputSchema.safeParse({
    ...validPumpfunInput,
    config: {
      ...validPumpfunInput.config,
      bundlerWalletCount: MAX_BUNDLE_WALLETS,
      devBuyAmountSol: MIN_BUY_AMOUNT_SOL,
      bundlerBuyAmountSol: MIN_BUY_AMOUNT_SOL,
    },
  });
  assert.equal(atLimits.success, true);
});

test("normalized money summary requires funding, spend, return, fee, and labeled line items", () => {
  const parsed = normalizedLaunchMoneySummarySchema.parse({
    immediateRequiredBalanceLamports: "1500000000",
    temporaryFundingLamports: "1000000000",
    permanentSpendLamports: "200000000",
    expectedReturnLamports: "800000000",
    expectedMainWalletDeltaNowLamports: "-1500000000",
    expectedMainWalletDeltaAfterCleanupLamports: "-200000000",
    usageFeeLamports: "50000000",
    lineItems: [
      { label: "Dev buy", amountLamports: "100000000" },
      { label: "Usage fee", amountLamports: "50000000" },
    ],
  });

  assert.equal(parsed.immediateRequiredBalanceLamports, "1500000000");
  assert.equal(parsed.lineItems.length, 2);
  assert.equal(parsed.lineItems[0]?.label, "Dev buy");
});

test("normalized money summary rejects non-integer lamport strings", () => {
  const result = normalizedLaunchMoneySummarySchema.safeParse({
    immediateRequiredBalanceLamports: "1.5",
    temporaryFundingLamports: "0",
    permanentSpendLamports: "0",
    expectedReturnLamports: "0",
    expectedMainWalletDeltaNowLamports: "0",
    expectedMainWalletDeltaAfterCleanupLamports: "0",
    usageFeeLamports: "0",
    lineItems: [],
  });
  assert.equal(result.success, false);
});

test("null Platform version identifies a legacy Launch or Token record", () => {
  assert.equal(isLegacyPlatformRecord({ platformVersion: null }), true);
  assert.equal(isLegacyPlatformRecord({ platformVersion: "1" }), false);
});

const validPumpfunPlan = {
  schemaVersion: "1" as const,
  platform: "PUMPFUN" as const,
  money: {
    immediateRequiredBalanceLamports: "1500000000",
    temporaryFundingLamports: "1000000000",
    permanentSpendLamports: "500000000",
    expectedReturnLamports: "1000000000",
    expectedMainWalletDeltaNowLamports: "-1500000000",
    expectedMainWalletDeltaAfterCleanupLamports: "-500000000",
    usageFeeLamports: "0",
    lineItems: [{ label: "Dev buy", amountLamports: "100000000" }],
  },
  wallets: {
    mainWalletPublicKey: "Main111111111111111111111111111111111111111",
    creatorWalletPublicKey: "Dev222222222222222222222222222222222222222",
    creatorWalletOption: "generate" as const,
    managedWallets: [],
  },
  allocations: {
    creatorBuyLamports: "100000000",
    bundlerBuyLamportsByWallet: [],
    jitoTipLamports: "0",
    mainReserveLamports: "0",
  },
  intendedEffects: {
    bundleBuyEnabled: false,
    mayhemMode: false,
    distributionWalletMultiplier: 1,
  },
  recovery: {
    policy: "plan_funded_cap" as const,
    capsByWalletPublicKey: {},
  },
  opaque: {
    bundlerBuyAllocationUsedFallback: false,
    platformFeeWaived: false,
    platformFeeDiscountRate: 0,
    hasSufficientMainWallet: true,
    mainWalletBalanceLamports: "5000000000",
  },
};

test("pump.fun plan schema strips vanity and attribution from intendedEffects", () => {
  const parsed = pumpfunLaunchPlanV1Schema.parse({
    ...validPumpfunPlan,
    intendedEffects: {
      ...validPumpfunPlan.intendedEffects,
      vanityMint: true,
      removeAttribution: false,
    },
  });
  assert.equal("vanityMint" in parsed.intendedEffects, false);
  assert.equal("removeAttribution" in parsed.intendedEffects, false);
});

test("pump.fun plan schema strips vanity reservation ids from opaque", () => {
  const parsed = pumpfunLaunchPlanV1Schema.parse({
    ...validPumpfunPlan,
    opaque: {
      ...validPumpfunPlan.opaque,
      reservedVanityMintId: "vanity-1",
      reservedVanityMintPublicKey: "Mint333333333333333333333333333333333333333",
    },
  });
  assert.equal("reservedVanityMintId" in parsed.opaque, false);
  assert.equal("reservedVanityMintPublicKey" in parsed.opaque, false);
});

test("launch plan envelope carries optionsOutcomes, money, and opaque platformPlan", () => {
  const parsed = launchPlanEnvelopeV1Schema.parse({
    shellVersion: "1",
    optionsOutcomes: {
      vanityMint: true,
      removeAttribution: false,
      mintPublicKey: "Mint333333333333333333333333333333333333333",
      plannedMintId: "planned-mint-1",
      reservedVanityMintId: "vanity-1",
    },
    money: validPumpfunPlan.money,
    platformPlan: validPumpfunPlan,
  });
  assert.equal(parsed.shellVersion, "1");
  assert.equal(parsed.optionsOutcomes.plannedMintId, "planned-mint-1");
  assert.equal(
    parsed.optionsOutcomes.mintPublicKey,
    "Mint333333333333333333333333333333333333333"
  );
  assert.equal(parsed.optionsOutcomes.reservedVanityMintId, "vanity-1");
  assert.equal(parsed.money.usageFeeLamports, "0");
  assert.deepEqual(parsed.platformPlan, validPumpfunPlan);
});

test("optionsOutcomes requires mintPublicKey and plannedMintId", () => {
  assert.throws(() =>
    launchPlanEnvelopeV1Schema.parse({
      shellVersion: "1",
      optionsOutcomes: {
        vanityMint: false,
        removeAttribution: false,
        reservedVanityMintId: null,
      },
      money: validPumpfunPlan.money,
      platformPlan: validPumpfunPlan,
    })
  );
});
