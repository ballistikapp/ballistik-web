export const launchPresetNames = ["regular", "free"] as const;

export type LaunchPresetName = (typeof launchPresetNames)[number];

export type LaunchPresetValues = {
  devWalletOption: "system" | "import" | "generate" | "use_main";
  bundleBuyEnabled: boolean;
  bundlerWalletCount: number;
  vanityMint: boolean;
  removeAttribution: boolean;
};

export const launchPresets: Record<LaunchPresetName, LaunchPresetValues> = {
  regular: {
    devWalletOption: "system",
    bundleBuyEnabled: true,
    bundlerWalletCount: 10,
    vanityMint: true,
    removeAttribution: false,
  },
  free: {
    devWalletOption: "system",
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
