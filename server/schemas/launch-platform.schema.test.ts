import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_BUNDLE_WALLETS,
  MIN_BUY_AMOUNT_SOL,
} from "@/lib/config/launch.config";
import {
  isLegacyPlatformRecord,
  normalizedLaunchMoneySummarySchema,
  versionedLaunchInputSchema,
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
  config: {
    devWalletOption: "use_main" as const,
    devBuyAmountSol: 0.1,
    jitoTipAmountSol: 0.001,
    bundleBuyEnabled: false,
    vanityMint: false,
    removeAttribution: false,
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
  assert.equal(parsed.config.devWalletOption, "use_main");
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
