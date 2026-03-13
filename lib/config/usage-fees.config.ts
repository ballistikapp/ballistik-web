export const generatedWalletFeeSol = 0.02;
export const vanityMintFeeSol = 0.1;
export const descriptionAttributionRemovalFeeSol = 0.1;
export const bundleBuyFeeSol = 0.1;

export type LaunchUsageFeeInput = {
  devWalletOption: "import" | "generate" | "use_main";
  bundleBuyEnabled: boolean;
  bundlerWalletCount: number;
  distributionWalletMultiplier: number;
  vanityMint: boolean;
  removeAttribution: boolean;
};

export type LaunchUsageFeeBreakdown = {
  generatedWalletCount: number;
  generatedWalletFeeSol: number;
  vanityMintFeeSol: number;
  descriptionAttributionRemovalFeeSol: number;
  bundleBuyFeeSol: number;
  totalFeeSol: number;
};

export type VolumeBotUsageFeeBreakdown = {
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
  const generatedWalletFeeValue = generatedWalletCount * generatedWalletFeeSol;
  const vanityFeeValue = input.vanityMint ? vanityMintFeeSol : 0;
  const attributionRemovalFeeValue = input.removeAttribution
    ? descriptionAttributionRemovalFeeSol
    : 0;
  const bundleBuyFeeValue = input.bundleBuyEnabled ? bundleBuyFeeSol : 0;
  const totalFeeSol =
    generatedWalletFeeValue +
    vanityFeeValue +
    attributionRemovalFeeValue +
    bundleBuyFeeValue;
  return {
    generatedWalletCount,
    generatedWalletFeeSol: generatedWalletFeeValue,
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
    generatedWalletCount: normalizedCount,
    generatedWalletFeeSol: generatedWalletFeeValue,
    totalFeeSol: generatedWalletFeeValue,
  };
}
