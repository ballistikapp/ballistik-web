import type { LaunchPresetValues } from "@/lib/config/launch-presets.config";
import {
  createDefaultLaunchFunnelFormValues,
  type LaunchFunnelFormValues,
  type PumpfunConfigFormValues,
  type SharedTokenMetadataFormValues,
} from "@/components/launch/launch-funnel-form-values";

const METADATA_KEYS = [
  "tokenName",
  "tokenSymbol",
  "description",
  "tokenImage",
  "tokenBanner",
  "twitter",
  "telegram",
  "website",
] as const satisfies ReadonlyArray<keyof SharedTokenMetadataFormValues>;

const CONFIG_KEYS = [
  "devWalletOption",
  "importedDevWalletKey",
  "devBuyAmountSol",
  "jitoTipAmountSol",
  "bundleBuyEnabled",
  "vanityMint",
  "removeAttribution",
  "mayhemMode",
  "bundlerWalletCount",
  "bundlerBuyAmountSol",
  "bundlerBuyVariancePercent",
  "distributionWalletMultiplier",
] as const satisfies ReadonlyArray<keyof PumpfunConfigFormValues>;

/**
 * Map flat preset/clone bags into nested funnel form values.
 * Media fields are skipped (clone never restores uploaded assets).
 * System creator wallet is never accepted into new-version funnel config.
 */
export function mapFlatInitialToLaunchFunnelValues(
  flat: Record<string, unknown> | null | undefined,
  base: LaunchFunnelFormValues = createDefaultLaunchFunnelFormValues()
): LaunchFunnelFormValues {
  if (!flat) {
    return {
      platform: "PUMPFUN",
      metadata: { ...base.metadata },
      config: { ...base.config },
    };
  }

  const metadata = { ...base.metadata };
  for (const key of METADATA_KEYS) {
    if (key === "tokenImage" || key === "tokenBanner") continue;
    if (key in flat && flat[key] != null) {
      metadata[key] = flat[key] as SharedTokenMetadataFormValues[typeof key];
    }
  }

  const config = { ...base.config };
  for (const key of CONFIG_KEYS) {
    if (!(key in flat) || flat[key] == null) continue;
    if (key === "devWalletOption" && flat[key] === "system") {
      config.devWalletOption = "generate";
      continue;
    }
    Object.assign(config, { [key]: flat[key] });
  }

  return {
    platform: "PUMPFUN",
    metadata,
    config,
  };
}

/** Apply a launch preset onto pump.fun config (shared metadata unchanged). */
export function applyPumpfunPresetToConfig(
  config: PumpfunConfigFormValues,
  preset: LaunchPresetValues
): PumpfunConfigFormValues {
  return {
    ...config,
    devWalletOption: preset.devWalletOption,
    bundleBuyEnabled: preset.bundleBuyEnabled,
    bundlerWalletCount: preset.bundlerWalletCount,
    vanityMint: preset.vanityMint,
    removeAttribution: preset.removeAttribution,
  };
}
