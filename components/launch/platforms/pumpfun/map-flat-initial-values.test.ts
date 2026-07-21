import assert from "node:assert/strict";
import test from "node:test";
import { launchPresets } from "@/lib/config/launch-presets.config";
import { createDefaultLaunchFunnelFormValues } from "@/components/launch/launch-funnel-form-values";
import {
  applyPumpfunPresetToConfig,
  mapFlatInitialToLaunchFunnelValues,
} from "./map-flat-initial-values";

test("mapFlatInitialToLaunchFunnelValues maps clone bag into nested metadata and config", () => {
  const nested = mapFlatInitialToLaunchFunnelValues({
    tokenName: "Cloned",
    tokenSymbol: "CLN",
    description: "From history",
    twitter: "https://x.com/cloned",
    devWalletOption: "use_main",
    devBuyAmountSol: 2,
    bundleBuyEnabled: true,
    bundlerWalletCount: 4,
    vanityMint: false,
    removeAttribution: true,
    mayhemMode: true,
    bundlerBuyAmountSol: 0.2,
    bundlerBuyVariancePercent: 10,
    distributionWalletMultiplier: 2,
    jitoTipAmountSol: 0.002,
  });

  assert.equal(nested.platform, "PUMPFUN");
  assert.equal(nested.metadata.tokenName, "Cloned");
  assert.equal(nested.metadata.tokenSymbol, "CLN");
  assert.equal(nested.metadata.description, "From history");
  assert.equal(nested.metadata.twitter, "https://x.com/cloned");
  assert.equal(nested.metadata.tokenImage, "");
  assert.equal(nested.config.devWalletOption, "use_main");
  assert.equal(nested.config.devBuyAmountSol, 2);
  assert.equal(nested.config.bundlerWalletCount, 4);
  assert.equal(nested.config.vanityMint, false);
  assert.equal(nested.config.mayhemMode, true);
});

test("mapFlatInitialToLaunchFunnelValues skips media and remaps system creator wallet", () => {
  const nested = mapFlatInitialToLaunchFunnelValues({
    tokenName: "LegacyShape",
    tokenSymbol: "LEG",
    tokenImage: "data:image/png;base64,should-skip",
    tokenBanner: "data:image/png;base64,banner-skip",
    devWalletOption: "system",
  });

  assert.equal(nested.metadata.tokenImage, "");
  assert.equal(nested.metadata.tokenBanner, "");
  assert.equal(nested.config.devWalletOption, "generate");
});

test("applyPumpfunPresetToConfig applies free and regular presets without touching metadata", () => {
  const base = createDefaultLaunchFunnelFormValues();
  const freeConfig = applyPumpfunPresetToConfig(
    base.config,
    launchPresets.free
  );
  assert.equal(freeConfig.bundleBuyEnabled, false);
  assert.equal(freeConfig.vanityMint, false);
  assert.equal(freeConfig.bundlerWalletCount, 5);
  assert.equal(freeConfig.devWalletOption, "generate");

  const regularConfig = applyPumpfunPresetToConfig(
    base.config,
    launchPresets.regular
  );
  assert.equal(regularConfig.bundleBuyEnabled, true);
  assert.equal(regularConfig.vanityMint, true);
  assert.equal(regularConfig.bundlerWalletCount, 8);
});
