import { z } from "zod";

const launchFieldsBase = {
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
    .max(500, "Description must be at most 500 characters")
    .optional(),
  tokenImage: z.string().min(1, "Main image or video is required"),
  tokenBanner: z.string().optional(),
  twitter: z.string().optional(),
  telegram: z.string().optional(),
  website: z.string().optional(),
  devWalletOption: z.enum(["import", "generate", "use_main"]),
  importedDevWalletKey: z.string().optional(),
  devBuyAmountSol: z
    .number()
    .min(0.05, "Dev buy must be at least 0.05 SOL.")
    .max(100, "Dev buy cannot exceed 100 SOL."),
  jitoTipAmountSol: z.number().min(0, "Jito tip amount must be 0 or more"),
  bundleBuyEnabled: z.boolean(),
  vanityMint: z.boolean(),
  removeAttribution: z.boolean(),
  bundlerWalletCount: z
    .number()
    .int()
    .min(0, "Bundler wallet count must be 0 or more")
    .max(10, "Bundler wallet count must be 10 or less"),
  bundlerBuyAmountSol: z
    .number()
    .min(0.05, "Buy amount per wallet must be at least 0.05 SOL."),
  bundlerBuyVariancePercent: z
    .number()
    .min(0, "Bundler buy variance must be 0 or more")
    .max(50, "Bundler buy variance must be 50 or less"),
  distributionWalletMultiplier: z
    .number()
    .int()
    .min(1, "Distribution multiplier must be at least 1")
    .max(5, "Distribution multiplier must be 5 or less"),
};

export const launchTokenSchema = z.object(launchFieldsBase);

/** Parses persisted launch rows (e.g. retry) that may still have `devWalletOption: "system"`. */
export const launchInputFromStorageSchema = z
  .object(launchFieldsBase)
  .extend({
    devWalletOption: z.enum(["system", "import", "generate", "use_main"]),
  });

export type DevWalletOption = LaunchTokenInput["devWalletOption"];

export const launchStatusSchema = z.object({
  launchId: z.string().min(1),
});

export const launchRetrySchema = z.object({
  launchId: z.string().min(1),
});

const launchPreviewFields = {
  devWalletOption: z.enum(["import", "generate", "use_main"]),
  importedDevWalletKey: z.string().optional(),
  devBuyAmountSol: z
    .number()
    .min(0.05, "Dev buy must be at least 0.05 SOL.")
    .max(100, "Dev buy cannot exceed 100 SOL."),
  jitoTipAmountSol: z.number().min(0, "Jito tip amount must be 0 or more"),
  bundleBuyEnabled: z.boolean(),
  vanityMint: z.boolean(),
  removeAttribution: z.boolean(),
  bundlerWalletCount: z
    .number()
    .int()
    .min(0, "Bundler wallet count must be 0 or more")
    .max(10, "Bundler wallet count must be 10 or less"),
  bundlerBuyAmountSol: z
    .number()
    .min(0.05, "Buy amount per wallet must be at least 0.05 SOL."),
  bundlerBuyVariancePercent: z
    .number()
    .min(0, "Bundler buy variance must be 0 or more")
    .max(50, "Bundler buy variance must be 50 or less"),
  distributionWalletMultiplier: z
    .number()
    .int()
    .min(1, "Distribution multiplier must be at least 1")
    .max(5, "Distribution multiplier must be 5 or less"),
};

export const launchPreviewCostsSchema = z.object(launchPreviewFields);

export const launchRecoverySchema = z.object({
  launchId: z.string().min(1),
});

export const launchRecoveryByTokenSchema = z.object({
  tokenPublicKey: z.string().min(1),
});

export const launchRecoverSolSchema = z.object({
  launchId: z.string().min(1),
  walletPublicKeys: z.array(z.string().min(1)).min(1).optional(),
});

export const launchRecoverSolByTokenSchema = z.object({
  tokenPublicKey: z.string().min(1),
  walletPublicKeys: z.array(z.string().min(1)).min(1).optional(),
});

export type LaunchTokenInput = z.infer<typeof launchTokenSchema>;
export type LaunchInputFromStorage = z.infer<typeof launchInputFromStorageSchema>;
export type LaunchPreviewCostsInput = z.infer<typeof launchPreviewCostsSchema>;
export type LaunchStatusInput = z.infer<typeof launchStatusSchema>;
export type LaunchRetryInput = z.infer<typeof launchRetrySchema>;
export type LaunchRecoveryInput = z.infer<typeof launchRecoverySchema>;
export type LaunchRecoveryByTokenInput = z.infer<
  typeof launchRecoveryByTokenSchema
>;
export type LaunchRecoverSolInput = z.infer<typeof launchRecoverSolSchema>;
export type LaunchRecoverSolByTokenInput = z.infer<
  typeof launchRecoverSolByTokenSchema
>;
