export const launchPresetNames = ["regular", "free"] as const;

export type LaunchPresetName = (typeof launchPresetNames)[number];

export type LaunchPresetValues = {
  devWalletOption: "import" | "generate" | "use_main";
  bundleBuyEnabled: boolean;
  bundlerWalletCount: number;
  vanityMint: boolean;
  removeAttribution: boolean;
};

export const launchPresets: Record<LaunchPresetName, LaunchPresetValues> = {
  regular: {
    devWalletOption: "generate",
    bundleBuyEnabled: true,
    bundlerWalletCount: 8,
    vanityMint: true,
    removeAttribution: false,
  },
  free: {
    devWalletOption: "generate",
    bundleBuyEnabled: false,
    bundlerWalletCount: 5,
    vanityMint: false,
    removeAttribution: false,
  },
};

export function getLaunchPresetName(
  preset: string | null | undefined
): LaunchPresetName {
  if (preset === "free") {
    return "free";
  }
  return "regular";
}

export function getLaunchPresetValues(
  preset: string | null | undefined
): LaunchPresetValues {
  return launchPresets[getLaunchPresetName(preset)];
}
