import * as z from "zod";
import {
  MAX_BUNDLE_WALLETS,
  MIN_BUY_AMOUNT_SOL,
} from "@/lib/config/launch.config";
import type { SubmittableFunnelPlatform } from "./platform-availability";

export const DEV_BUY_SOL_MIN = MIN_BUY_AMOUNT_SOL;
export const DEV_BUY_SOL_MAX = 100;
export const BUNDLER_BUY_PER_WALLET_MIN = MIN_BUY_AMOUNT_SOL;

export const sharedTokenMetadataFormSchema = z.object({
  tokenName: z
    .string()
    .min(1, "Token name is required")
    .max(32, "Token name must be at most 32 characters"),
  tokenSymbol: z
    .string()
    .min(1, "Token symbol is required")
    .max(10, "Token symbol must be at most 10 characters"),
  description: z
    .string()
    .max(500, "Description must be at most 500 characters"),
  tokenImage: z.string().min(1, "Main image or video is required"),
  tokenBanner: z.string(),
  twitter: z.string(),
  telegram: z.string(),
  website: z.string(),
});

export const launchOptionsFormSchema = z.object({
  vanityMint: z.boolean(),
  removeAttribution: z.boolean(),
});

export const pumpfunConfigFormSchema = z
  .object({
    devWalletOption: z.enum(["import", "generate", "use_main"]),
    importedDevWalletKey: z.string(),
    devBuyAmountSol: z
      .number()
      .min(
        DEV_BUY_SOL_MIN,
        `Dev buy must be at least ${DEV_BUY_SOL_MIN} SOL.`
      )
      .max(DEV_BUY_SOL_MAX, `Dev buy cannot exceed ${DEV_BUY_SOL_MAX} SOL.`),
    jitoTipAmountSol: z.number().min(0, "Jito tip amount must be 0 or more"),
    bundleBuyEnabled: z.boolean(),
    mayhemMode: z.boolean(),
    bundlerWalletCount: z
      .number()
      .int()
      .min(0, "Bundler wallet count must be 0 or more")
      .max(
        MAX_BUNDLE_WALLETS,
        `Bundler wallet count must be ${MAX_BUNDLE_WALLETS} or less`
      ),
    bundlerBuyAmountSol: z
      .number()
      .min(
        BUNDLER_BUY_PER_WALLET_MIN,
        `Buy amount per wallet must be at least ${BUNDLER_BUY_PER_WALLET_MIN} SOL.`
      ),
    bundlerBuyVariancePercent: z
      .number()
      .min(0, "Bundler buy variance must be 0 or more")
      .max(50, "Bundler buy variance must be 50 or less"),
    distributionWalletMultiplier: z
      .number()
      .int()
      .min(1, "Distribution multiplier must be at least 1")
      .max(5, "Distribution multiplier must be 5 or less"),
  })
  .superRefine((values, ctx) => {
    if (
      values.devWalletOption === "import" &&
      !values.importedDevWalletKey.trim()
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["importedDevWalletKey"],
        message: "Dev wallet private key is required",
      });
    }
  });

export const launchFunnelFormSchema = z.object({
  platform: z.literal("PUMPFUN"),
  metadata: sharedTokenMetadataFormSchema,
  options: launchOptionsFormSchema,
  config: pumpfunConfigFormSchema,
});

export type LaunchFunnelFormValues = z.infer<typeof launchFunnelFormSchema>;
export type SharedTokenMetadataFormValues = z.infer<
  typeof sharedTokenMetadataFormSchema
>;
export type LaunchOptionsFormValues = z.infer<typeof launchOptionsFormSchema>;
export type PumpfunConfigFormValues = z.infer<typeof pumpfunConfigFormSchema>;

export const DEFAULT_SHARED_TOKEN_METADATA: SharedTokenMetadataFormValues = {
  tokenName: "",
  tokenSymbol: "",
  description: "",
  tokenImage: "",
  tokenBanner: "",
  twitter: "",
  telegram: "",
  website: "",
};

export const DEFAULT_LAUNCH_OPTIONS: LaunchOptionsFormValues = {
  vanityMint: true,
  removeAttribution: false,
};

export const DEFAULT_PUMPFUN_CONFIG: PumpfunConfigFormValues = {
  devWalletOption: "generate",
  importedDevWalletKey: "",
  devBuyAmountSol: 0.5,
  jitoTipAmountSol: 0.005,
  bundleBuyEnabled: true,
  mayhemMode: false,
  bundlerWalletCount: 8,
  bundlerBuyAmountSol: 0.1,
  bundlerBuyVariancePercent: 20,
  distributionWalletMultiplier: 1,
};

export function createDefaultLaunchFunnelFormValues(
  platform: SubmittableFunnelPlatform = "PUMPFUN"
): LaunchFunnelFormValues {
  return {
    platform,
    metadata: { ...DEFAULT_SHARED_TOKEN_METADATA },
    options: { ...DEFAULT_LAUNCH_OPTIONS },
    config: { ...DEFAULT_PUMPFUN_CONFIG },
  };
}

export function bundlerWalletCountValidatorMessage(
  value: unknown
): string | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "Enter a valid number of wallets.";
  }
  if (!Number.isInteger(value)) {
    return "Use a whole number of wallets.";
  }
  if (value < 0) {
    return "Bundler wallet count cannot be negative.";
  }
  if (value > MAX_BUNDLE_WALLETS) {
    return `Bundler wallet count cannot exceed ${MAX_BUNDLE_WALLETS}.`;
  }
  return undefined;
}
