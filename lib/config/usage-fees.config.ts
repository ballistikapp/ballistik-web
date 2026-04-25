export const generatedWalletFeeSol = 0.02;
export const vanityMintFeeSol = 0.1;
export const descriptionAttributionRemovalFeeSol = 0.1;
export const bundleBuyFeeSol = 0.1;
export const bundledExitFeeSol = 0.1;
/** Legacy: was 0.1 SOL; launch no longer charges a non-system dev wallet fee. */
export const nonSystemDevWalletFeeSol = 0;

export type LaunchUsageFeeInput = {
  devWalletOption: "system" | "import" | "generate" | "use_main";
  bundleBuyEnabled: boolean;
  bundlerWalletCount: number;
  distributionWalletMultiplier: number;
  vanityMint: boolean;
  removeAttribution: boolean;
};

export type LaunchUsageFeeBreakdown = {
  platformFeeWaived: boolean;
  platformFeeDiscountRate: number;
  /** All generated keypairs (dev + bundler + distribution) for display and limits. */
  generatedWalletCount: number;
  /** Wallets that count toward the 0.02/SOL line (excludes the dev keypair when generating a new dev wallet). */
  generatedWalletsBilledForFeeCount: number;
  generatedWalletFeeSol: number;
  nonSystemDevWalletFeeSol: number;
  vanityMintFeeSol: number;
  descriptionAttributionRemovalFeeSol: number;
  bundleBuyFeeSol: number;
  totalFeeSol: number;
};

export type VolumeBotUsageFeeBreakdown = {
  platformFeeWaived: boolean;
  platformFeeDiscountRate: number;
  generatedWalletCount: number;
  generatedWalletFeeSol: number;
  totalFeeSol: number;
};

export function calculateLaunchGeneratedWalletCount(
  input: Pick<
    LaunchUsageFeeInput,
    | "devWalletOption"
    | "bundleBuyEnabled"
    | "bundlerWalletCount"
    | "distributionWalletMultiplier"
  >
) {
  const bundlerWalletCount = input.bundleBuyEnabled
    ? Math.max(0, Math.floor(input.bundlerWalletCount))
    : 0;
  const distributionMultiplier = Math.max(
    1,
    Math.floor(input.distributionWalletMultiplier)
  );
  const generatedDevWalletCount = input.devWalletOption === "generate" ? 1 : 0;
  const distributionWalletCount =
    bundlerWalletCount > 0
      ? bundlerWalletCount * Math.max(0, distributionMultiplier - 1)
      : 0;
  return generatedDevWalletCount + bundlerWalletCount + distributionWalletCount;
}

export function calculateLaunchUsageFees(
  input: LaunchUsageFeeInput
): LaunchUsageFeeBreakdown {
  const generatedWalletCount = calculateLaunchGeneratedWalletCount(input);
  const devKeypairExemptFromGeneratedFee =
    input.devWalletOption === "generate" ? 1 : 0;
  const generatedWalletsBilledForFeeCount = Math.max(
    0,
    generatedWalletCount - devKeypairExemptFromGeneratedFee
  );
  const generatedWalletFeeValue =
    generatedWalletsBilledForFeeCount * generatedWalletFeeSol;
  const vanityFeeValue = input.vanityMint ? vanityMintFeeSol : 0;
  const attributionRemovalFeeValue = input.removeAttribution
    ? descriptionAttributionRemovalFeeSol
    : 0;
  const bundleBuyFeeValue = input.bundleBuyEnabled ? bundleBuyFeeSol : 0;
  const nonSystemDevWalletValue = 0;
  const totalFeeSol =
    generatedWalletFeeValue +
    nonSystemDevWalletValue +
    vanityFeeValue +
    attributionRemovalFeeValue +
    bundleBuyFeeValue;
  return {
    platformFeeWaived: false,
    platformFeeDiscountRate: 0,
    generatedWalletCount,
    generatedWalletsBilledForFeeCount,
    generatedWalletFeeSol: generatedWalletFeeValue,
    nonSystemDevWalletFeeSol: nonSystemDevWalletValue,
    vanityMintFeeSol: vanityFeeValue,
    descriptionAttributionRemovalFeeSol: attributionRemovalFeeValue,
    bundleBuyFeeSol: bundleBuyFeeValue,
    totalFeeSol,
  };
}

export function calculateVolumeBotUsageFees(
  generatedWalletCount: number
): VolumeBotUsageFeeBreakdown {
  const normalizedCount = Math.max(0, Math.floor(generatedWalletCount));
  const generatedWalletFeeValue = normalizedCount * generatedWalletFeeSol;
  return {
    platformFeeWaived: false,
    platformFeeDiscountRate: 0,
    generatedWalletCount: normalizedCount,
    generatedWalletFeeSol: generatedWalletFeeValue,
    totalFeeSol: generatedWalletFeeValue,
  };
}

export function waiveLaunchUsageFees(
  breakdown: LaunchUsageFeeBreakdown
): LaunchUsageFeeBreakdown {
  return {
    ...breakdown,
    platformFeeWaived: true,
    platformFeeDiscountRate: 1,
    generatedWalletsBilledForFeeCount: 0,
    generatedWalletFeeSol: 0,
    nonSystemDevWalletFeeSol: 0,
    vanityMintFeeSol: 0,
    descriptionAttributionRemovalFeeSol: 0,
    bundleBuyFeeSol: 0,
    totalFeeSol: 0,
  };
}

export function waiveVolumeBotUsageFees(
  breakdown: VolumeBotUsageFeeBreakdown
): VolumeBotUsageFeeBreakdown {
  return {
    ...breakdown,
    platformFeeWaived: true,
    platformFeeDiscountRate: 1,
    generatedWalletFeeSol: 0,
    totalFeeSol: 0,
  };
}

function roundSol(amount: number): number {
  return Math.round(amount * 1_000_000_000) / 1_000_000_000;
}

export function discountLaunchUsageFees(
  breakdown: LaunchUsageFeeBreakdown,
  discountRate: number
): LaunchUsageFeeBreakdown {
  const multiplier = 1 - discountRate;
  return {
    ...breakdown,
    platformFeeDiscountRate: discountRate,
    totalFeeSol: roundSol(breakdown.totalFeeSol * multiplier),
  };
}

export function discountVolumeBotUsageFees(
  breakdown: VolumeBotUsageFeeBreakdown,
  discountRate: number
): VolumeBotUsageFeeBreakdown {
  const multiplier = 1 - discountRate;
  return {
    ...breakdown,
    platformFeeDiscountRate: discountRate,
    totalFeeSol: roundSol(breakdown.totalFeeSol * multiplier),
  };
}
