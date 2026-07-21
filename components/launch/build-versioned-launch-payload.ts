import type {
  VersionedLaunchInput,
  VersionedLaunchPreviewInput,
} from "@/server/schemas/launch-platform.schema";
import type { LaunchFunnelFormValues } from "./launch-funnel-form-values";
import { isSubmittableFunnelPlatform } from "./platform-availability";

const LAUNCH_INPUT_SCHEMA_VERSION_V1 = 1 as const;

function toSharedMetadata(
  metadata: LaunchFunnelFormValues["metadata"]
): VersionedLaunchInput["metadata"] {
  return {
    tokenName: metadata.tokenName,
    tokenSymbol: metadata.tokenSymbol,
    tokenImage: metadata.tokenImage,
    ...(metadata.description ? { description: metadata.description } : {}),
    ...(metadata.tokenBanner ? { tokenBanner: metadata.tokenBanner } : {}),
    ...(metadata.twitter ? { twitter: metadata.twitter } : {}),
    ...(metadata.telegram ? { telegram: metadata.telegram } : {}),
    ...(metadata.website ? { website: metadata.website } : {}),
  };
}

function toPumpfunConfig(
  config: LaunchFunnelFormValues["config"]
): VersionedLaunchInput["config"] {
  return {
    devWalletOption: config.devWalletOption,
    ...(config.devWalletOption === "import" && config.importedDevWalletKey
      ? { importedDevWalletKey: config.importedDevWalletKey }
      : {}),
    devBuyAmountSol: config.devBuyAmountSol,
    jitoTipAmountSol: config.jitoTipAmountSol,
    bundleBuyEnabled: config.bundleBuyEnabled,
    vanityMint: config.vanityMint,
    removeAttribution: config.removeAttribution,
    mayhemMode: config.mayhemMode,
    bundlerWalletCount: config.bundlerWalletCount,
    bundlerBuyAmountSol: config.bundlerBuyAmountSol,
    bundlerBuyVariancePercent: config.bundlerBuyVariancePercent,
    distributionWalletMultiplier: config.distributionWalletMultiplier,
  };
}

/**
 * Assemble the versioned start payload from nested funnel form values.
 * Returns null when the selected Platform cannot be submitted (e.g. SPL).
 */
export function buildVersionedLaunchInput(
  values: LaunchFunnelFormValues
): VersionedLaunchInput | null {
  if (!isSubmittableFunnelPlatform(values.platform)) {
    return null;
  }
  return {
    schemaVersion: LAUNCH_INPUT_SCHEMA_VERSION_V1,
    platform: "PUMPFUN",
    metadata: toSharedMetadata(values.metadata),
    config: toPumpfunConfig(values.config),
  };
}

/**
 * Assemble the versioned preview payload (Platform + config only).
 * Returns null when the selected Platform cannot be previewed/submitted.
 */
export function buildVersionedLaunchPreviewInput(
  values: Pick<LaunchFunnelFormValues, "platform" | "config">
): VersionedLaunchPreviewInput | null {
  if (!isSubmittableFunnelPlatform(values.platform)) {
    return null;
  }
  return {
    schemaVersion: LAUNCH_INPUT_SCHEMA_VERSION_V1,
    platform: "PUMPFUN",
    config: toPumpfunConfig(values.config),
  };
}
