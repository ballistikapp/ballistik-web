import { z } from "zod";

/** First explicit Platform/version identity for new Launch and Token records. */
export const LAUNCH_PLATFORM_VERSION_V1 = "1" as const;

/** Schema version for the discriminated versioned Launch input contract. */
export const LAUNCH_INPUT_SCHEMA_VERSION_V1 = 1 as const;

export const launchPlatformIdSchema = z.enum(["PUMPFUN"]);
export type LaunchPlatformId = z.infer<typeof launchPlatformIdSchema>;

const sharedTokenMetadataFields = {
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
};

export const sharedTokenMetadataSchema = z.object(sharedTokenMetadataFields);
export type SharedTokenMetadata = z.infer<typeof sharedTokenMetadataSchema>;

export const pumpfunLaunchConfigSchema = z.object({
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
  /** Pump.fun Mayhem mode: create_v2 (Token-2022), AI-agent trading for 24h. Beta, immutable once launched. */
  mayhemMode: z.boolean().optional().default(false),
  bundlerWalletCount: z
    .number()
    .int()
    .min(0, "Bundler wallet count must be 0 or more")
    .max(8, "Bundler wallet count must be 8 or less"),
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
});
export type PumpfunLaunchConfig = z.infer<typeof pumpfunLaunchConfigSchema>;

const pumpfunVersionedLaunchInputSchema = z.object({
  schemaVersion: z.literal(LAUNCH_INPUT_SCHEMA_VERSION_V1),
  platform: z.literal("PUMPFUN"),
  metadata: sharedTokenMetadataSchema,
  config: pumpfunLaunchConfigSchema,
});

/**
 * New Launch submissions use a discriminated Platform shape.
 * Only pump.fun is a valid persisted execution Platform in this effort.
 */
export const versionedLaunchInputSchema = z.discriminatedUnion("platform", [
  pumpfunVersionedLaunchInputSchema,
]);
export type VersionedLaunchInput = z.infer<typeof versionedLaunchInputSchema>;

/** Integer lamports as a decimal string so summaries survive Prisma Json persistence. */
const lamportsStringSchema = z
  .string()
  .regex(/^-?\d+$/, "Lamports must be an integer decimal string");

export const launchMoneyLineItemSchema = z.object({
  label: z.string().min(1),
  amountLamports: lamportsStringSchema,
});
export type LaunchMoneyLineItem = z.infer<typeof launchMoneyLineItemSchema>;

/**
 * Shared preview/plan monetary summary. Platform execution details stay opaque.
 * Amounts are string lamports for Json-safe plan/preview persistence.
 */
export const normalizedLaunchMoneySummarySchema = z.object({
  immediateRequiredBalanceLamports: lamportsStringSchema,
  temporaryFundingLamports: lamportsStringSchema,
  permanentSpendLamports: lamportsStringSchema,
  expectedReturnLamports: lamportsStringSchema,
  expectedMainWalletDeltaNowLamports: lamportsStringSchema,
  expectedMainWalletDeltaAfterCleanupLamports: lamportsStringSchema,
  usageFeeLamports: lamportsStringSchema,
  lineItems: z.array(launchMoneyLineItemSchema),
});
export type NormalizedLaunchMoneySummary = z.infer<
  typeof normalizedLaunchMoneySummarySchema
>;

/**
 * Null Platform version marks a legacy Launch or Token.
 * Do not infer legacy status from JSON input shape.
 */
export function isLegacyPlatformRecord(record: {
  platformVersion: string | null | undefined;
}): boolean {
  return record.platformVersion == null;
}
