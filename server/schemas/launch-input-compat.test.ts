import assert from "node:assert/strict";
import test from "node:test";
import {
  buildNewLaunchPersistence,
  flattenVersionedLaunchInput,
  launchInputDisplayFields,
  resolveStoredLaunchInput,
  toVersionedLaunchInput,
} from "./launch-input-compat";
import type { VersionedLaunchInput } from "./launch-platform.schema";

const versionedPumpfunInput: VersionedLaunchInput = {
  schemaVersion: 1,
  platform: "PUMPFUN",
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
    devWalletOption: "use_main",
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

test("flattenVersionedLaunchInput maps metadata and pump config to flat legacy/clone shape", () => {
  const flat = flattenVersionedLaunchInput(versionedPumpfunInput);
  assert.equal(flat.tokenName, "Test Token");
  assert.equal(flat.tokenSymbol, "TEST");
  assert.equal(flat.devWalletOption, "use_main");
  assert.equal(flat.devBuyAmountSol, 0.1);
  assert.equal(flat.bundleBuyEnabled, false);
});

test("toVersionedLaunchInput nests flat fields under metadata and config", () => {
  const flat = flattenVersionedLaunchInput(versionedPumpfunInput);
  const nested = toVersionedLaunchInput(flat);
  assert.deepEqual(nested, versionedPumpfunInput);
});

test("buildNewLaunchPersistence sets PUMPFUN platform identity and versioned input", () => {
  const persistence = buildNewLaunchPersistence(versionedPumpfunInput, {
    plan: "PRO",
    launchRealtimeEnabled: true,
    platformFeeWaived: true,
  });

  assert.equal(persistence.platform, "PUMPFUN");
  assert.equal(persistence.platformVersion, "1");
  assert.equal(persistence.input.schemaVersion, 1);
  assert.equal(persistence.input.platform, "PUMPFUN");
  assert.equal(persistence.input.metadata.tokenName, "Test Token");
  assert.equal(persistence.input.entitlementSnapshot?.plan, "PRO");
});

test("resolveStoredLaunchInput reads versioned persisted input for execution", () => {
  const persistence = buildNewLaunchPersistence(versionedPumpfunInput, {
    plan: "FREE",
    launchRealtimeEnabled: false,
    platformFeeWaived: false,
  });

  const resolved = resolveStoredLaunchInput(persistence.input);
  assert.ok(resolved);
  assert.equal(resolved.tokenName, "Test Token");
  assert.equal(resolved.devWalletOption, "use_main");
  assert.equal(resolved.entitlementSnapshot?.plan, "FREE");
});

test("resolveStoredLaunchInput keeps legacy flat input readable without migration", () => {
  const legacyFlat = {
    tokenName: "Legacy",
    tokenSymbol: "LEG",
    tokenImage: "https://example.com/legacy.png",
    devWalletOption: "system",
    devBuyAmountSol: 0.1,
    jitoTipAmountSol: 0,
    bundleBuyEnabled: false,
    vanityMint: false,
    removeAttribution: false,
    bundlerWalletCount: 0,
    bundlerBuyAmountSol: 0.05,
    bundlerBuyVariancePercent: 0,
    distributionWalletMultiplier: 1,
    entitlementSnapshot: {
      plan: "FREE",
      launchRealtimeEnabled: false,
      platformFeeWaived: false,
    },
  };

  const resolved = resolveStoredLaunchInput(legacyFlat);
  assert.ok(resolved);
  assert.equal(resolved.tokenName, "Legacy");
  assert.equal(resolved.devWalletOption, "system");
  assert.equal(resolved.entitlementSnapshot?.plan, "FREE");
});

test("launchInputDisplayFields reads names from versioned or flat input", () => {
  const fromVersioned = launchInputDisplayFields(versionedPumpfunInput);
  assert.equal(fromVersioned.tokenName, "Test Token");
  assert.equal(fromVersioned.tokenSymbol, "TEST");

  const fromFlat = launchInputDisplayFields({
    tokenName: "Flat",
    tokenSymbol: "FLT",
    tokenImage: "https://example.com/f.png",
    devWalletOption: "generate",
    devBuyAmountSol: 0.1,
    jitoTipAmountSol: 0,
    bundleBuyEnabled: false,
    vanityMint: false,
    removeAttribution: false,
    bundlerWalletCount: 0,
    bundlerBuyAmountSol: 0.05,
    bundlerBuyVariancePercent: 0,
    distributionWalletMultiplier: 1,
  });
  assert.equal(fromFlat.tokenName, "Flat");
  assert.equal(fromFlat.website, null);
});
