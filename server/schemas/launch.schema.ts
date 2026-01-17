import { z } from "zod";

const numericString = z
  .string()
  .refine((value) => !Number.isNaN(Number(value)), "Must be a number");

export const launchTokenSchema = z.object({
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
    .min(20, "Description must be at least 20 characters")
    .max(500, "Description must be at most 500 characters"),
  tokenImage: z.string(),
  twitter: z.string().optional(),
  telegram: z.string().optional(),
  website: z.string().optional(),
  devWalletOption: z.enum(["import", "generate", "use_main"]),
  importedDevWalletKey: z.string().optional(),
  devBuyAmount: numericString,
  jitoTipAmount: numericString,
  bundleBuyEnabled: z.boolean(),
  vanityMint: z.boolean(),
  numberOfWallets: numericString,
  buyAmountPerWallet: numericString,
  buyAmountVariance: numericString,
  distributionMultiplier: numericString,
});

export const launchStatusSchema = z.object({
  launchId: z.string().min(1),
});

export type LaunchTokenInput = z.infer<typeof launchTokenSchema>;
export type LaunchStatusInput = z.infer<typeof launchStatusSchema>;
