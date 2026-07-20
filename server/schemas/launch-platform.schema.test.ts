import assert from "node:assert/strict";
import test from "node:test";
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

test("normalized money summary requires funding, spend, return, fee, and labeled line items", () => {
  const parsed = normalizedLaunchMoneySummarySchema.parse({
    immediateRequiredBalanceLamports: BigInt(1_500_000_000),
    temporaryFundingLamports: BigInt(1_000_000_000),
    permanentSpendLamports: BigInt(200_000_000),
    expectedReturnLamports: BigInt(800_000_000),
    expectedMainWalletDeltaNowLamports: BigInt(-1_500_000_000),
    expectedMainWalletDeltaAfterCleanupLamports: BigInt(-200_000_000),
    usageFeeLamports: BigInt(50_000_000),
    lineItems: [
      { label: "Dev buy", amountLamports: BigInt(100_000_000) },
      { label: "Usage fee", amountLamports: BigInt(50_000_000) },
    ],
  });

  assert.equal(parsed.immediateRequiredBalanceLamports, BigInt(1_500_000_000));
  assert.equal(parsed.lineItems.length, 2);
  assert.equal(parsed.lineItems[0]?.label, "Dev buy");
});

test("null Platform version identifies a legacy Launch or Token record", () => {
  assert.equal(isLegacyPlatformRecord({ platformVersion: null }), true);
  assert.equal(isLegacyPlatformRecord({ platformVersion: "1" }), false);
});
