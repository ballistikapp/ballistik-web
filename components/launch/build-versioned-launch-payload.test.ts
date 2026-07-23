import assert from "node:assert/strict";
import test from "node:test";
import {
  buildVersionedLaunchInput,
  buildVersionedLaunchPreviewInput,
} from "./build-versioned-launch-payload";
import { createDefaultLaunchFunnelFormValues } from "./launch-funnel-form-values";

test("buildVersionedLaunchInput nests metadata, options, and pump config for PUMPFUN", () => {
  const values = createDefaultLaunchFunnelFormValues();
  values.metadata.tokenName = "Alpha";
  values.metadata.tokenSymbol = "ALP";
  values.metadata.tokenImage = "data:image/png;base64,abc";
  values.metadata.description = "A token";
  values.options.vanityMint = true;
  values.options.removeAttribution = false;
  values.config.devWalletOption = "use_main";
  values.config.devBuyAmountSol = 1.25;
  values.config.bundleBuyEnabled = false;

  const payload = buildVersionedLaunchInput(values);
  assert.ok(payload);
  assert.deepEqual(payload, {
    schemaVersion: 1,
    platform: "PUMPFUN",
    metadata: {
      tokenName: "Alpha",
      tokenSymbol: "ALP",
      tokenImage: "data:image/png;base64,abc",
      description: "A token",
    },
    options: {
      vanityMint: true,
      removeAttribution: false,
    },
    config: {
      devWalletOption: "use_main",
      devBuyAmountSol: 1.25,
      jitoTipAmountSol: 0.005,
      bundleBuyEnabled: false,
      mayhemMode: false,
      bundlerWalletCount: 8,
      bundlerBuyAmountSol: 0.1,
      bundlerBuyVariancePercent: 20,
      distributionWalletMultiplier: 1,
    },
  });
});

test("buildVersionedLaunchInput includes imported key only for import option", () => {
  const values = createDefaultLaunchFunnelFormValues();
  values.metadata.tokenName = "Beta";
  values.metadata.tokenSymbol = "BET";
  values.metadata.tokenImage = "data:image/png;base64,xyz";
  values.config.devWalletOption = "import";
  values.config.importedDevWalletKey = "secret-key";

  const payload = buildVersionedLaunchInput(values);
  assert.ok(payload);
  assert.equal(payload.config.devWalletOption, "import");
  assert.equal(payload.config.importedDevWalletKey, "secret-key");
  assert.ok(!("system" in payload.config));
});

test("buildVersionedLaunchInput rejects non-submittable Platform selection", () => {
  const values = createDefaultLaunchFunnelFormValues();
  // Simulate a future/disabled platform id that cannot submit.
  const blocked = {
    ...values,
    platform: "SPL" as unknown as "PUMPFUN",
  };
  assert.equal(buildVersionedLaunchInput(blocked), null);
  assert.equal(buildVersionedLaunchPreviewInput(blocked), null);
});

test("buildVersionedLaunchPreviewInput includes Launch Options and omits metadata", () => {
  const values = createDefaultLaunchFunnelFormValues();
  values.metadata.tokenName = "ShouldNotAppear";
  values.options.vanityMint = false;

  const preview = buildVersionedLaunchPreviewInput(values);
  assert.ok(preview);
  assert.equal(preview.platform, "PUMPFUN");
  assert.equal(preview.options.vanityMint, false);
  assert.equal("metadata" in preview, false);
  assert.equal("vanityMint" in preview.config, false);
});
