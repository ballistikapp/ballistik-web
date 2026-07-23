import { z } from "zod";
import {
  MAX_BUNDLE_WALLETS,
  MIN_BUY_AMOUNT_SOL,
} from "@/lib/config/launch.config";
import { isLegacyPlatformVersion } from "@/lib/launch/legacy-capability";

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

/**
 * Shared Launch Options — Platform-agnostic settings owned by the lifecycle.
 * Vanity mint intent and Launch Attribution removal live here, not in Platform config.
 */
export const launchOptionsSchema = z.object({
  vanityMint: z.boolean(),
  removeAttribution: z.boolean(),
});
export type LaunchOptions = z.infer<typeof launchOptionsSchema>;

export const pumpfunLaunchConfigSchema = z
  .object({
    devWalletOption: z.enum(["import", "generate", "use_main"]),
    importedDevWalletKey: z.string().optional(),
    devBuyAmountSol: z
      .number()
      .min(MIN_BUY_AMOUNT_SOL, `Dev buy must be at least ${MIN_BUY_AMOUNT_SOL} SOL.`)
      .max(100, "Dev buy cannot exceed 100 SOL."),
    jitoTipAmountSol: z.number().min(0, "Jito tip amount must be 0 or more"),
    bundleBuyEnabled: z.boolean(),
    /** Pump.fun Mayhem mode: create_v2 (Token-2022), AI-agent trading for 24h. Beta, immutable once launched. */
    mayhemMode: z.boolean().optional().default(false),
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
        MIN_BUY_AMOUNT_SOL,
        `Buy amount per wallet must be at least ${MIN_BUY_AMOUNT_SOL} SOL.`
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
  .strict();
export type PumpfunLaunchConfig = z.infer<typeof pumpfunLaunchConfigSchema>;

const pumpfunVersionedLaunchInputSchema = z.object({
  schemaVersion: z.literal(LAUNCH_INPUT_SCHEMA_VERSION_V1),
  platform: z.literal("PUMPFUN"),
  metadata: sharedTokenMetadataSchema,
  options: launchOptionsSchema,
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
 * Preview accepts versioned Platform identity + Launch Options + config without
 * requiring shared Token metadata (cost quotes stay responsive while editing).
 */
export const versionedLaunchPreviewInputSchema = z.discriminatedUnion(
  "platform",
  [
    z.object({
      schemaVersion: z.literal(LAUNCH_INPUT_SCHEMA_VERSION_V1),
      platform: z.literal("PUMPFUN"),
      options: launchOptionsSchema,
      config: pumpfunLaunchConfigSchema,
    }),
  ]
);
export type VersionedLaunchPreviewInput = z.infer<
  typeof versionedLaunchPreviewInputSchema
>;

/**
 * API/review envelope: shared normalized money plus wallet/policy fields the
 * review surface needs that are not part of Platform money itself.
 */
export const launchPlatformPreviewResultSchema = z.object({
  money: normalizedLaunchMoneySummarySchema,
  mainWalletBalanceLamports: lamportsStringSchema,
  hasSufficientMainWallet: z.boolean(),
  platformFeeWaived: z.boolean(),
  platformFeeDiscountRate: z.number().min(0).max(1),
});
export type LaunchPlatformPreviewResult = z.infer<
  typeof launchPlatformPreviewResultSchema
>;

/** Schema version for the secret-free pump.fun authoritative plan payload. */
export const PUMPFUN_PLAN_SCHEMA_VERSION_V1 = "1" as const;

/** Schema version for the shared Launch plan envelope (optionsOutcomes + platformPlan). */
export const LAUNCH_PLAN_SHELL_VERSION_V1 = "1" as const;

const pumpfunPlanWalletSchema = z.object({
  publicKey: z.string().min(1),
  platformRole: z.string().min(1),
  isManaged: z.boolean(),
  /**
   * Required balance target for this attempt (funding authority).
   * Failed-launch reclaim uses the recorded top-up on Managed Launch Wallet rows,
   * not this required-target value, so shared/imported prior balances are not swept.
   */
  fundedCapLamports: lamportsStringSchema,
});

/**
 * Secret-free pump.fun plan. Validated whenever persisted data re-enters
 * execute/recover. Never contains private keys or raw secret material.
 * Vanity reservation and Launch Attribution live in the plan envelope's
 * optionsOutcomes — not in intendedEffects / opaque.
 */
export const pumpfunLaunchPlanV1Schema = z.object({
  schemaVersion: z.literal(PUMPFUN_PLAN_SCHEMA_VERSION_V1),
  platform: z.literal("PUMPFUN"),
  money: normalizedLaunchMoneySummarySchema,
  wallets: z.object({
    mainWalletPublicKey: z.string().min(1),
    creatorWalletPublicKey: z.string().min(1),
    creatorWalletOption: z.enum(["import", "generate", "use_main"]),
    managedWallets: z.array(pumpfunPlanWalletSchema),
  }),
  allocations: z.object({
    creatorBuyLamports: lamportsStringSchema,
    bundlerBuyLamportsByWallet: z.array(
      z.object({
        publicKey: z.string().min(1),
        amountLamports: lamportsStringSchema,
      })
    ),
    jitoTipLamports: lamportsStringSchema,
    mainReserveLamports: lamportsStringSchema,
  }),
  intendedEffects: z.object({
    bundleBuyEnabled: z.boolean(),
    mayhemMode: z.boolean(),
    distributionWalletMultiplier: z.number().int().min(1).max(5),
  }),
  recovery: z.object({
    policy: z.literal("plan_funded_cap"),
    capsByWalletPublicKey: z.record(z.string(), lamportsStringSchema),
  }),
  /** Opaque pump payload — still secret-free; Platform-owned fields. */
  opaque: z.object({
    bundlerBuyAllocationUsedFallback: z.boolean(),
    platformFeeWaived: z.boolean(),
    platformFeeDiscountRate: z.number().min(0).max(1),
    hasSufficientMainWallet: z.boolean(),
    mainWalletBalanceLamports: lamportsStringSchema,
  }),
});
export type PumpfunLaunchPlanV1 = z.infer<typeof pumpfunLaunchPlanV1Schema>;

/**
 * Launch Options outcomes materialized by the shared lifecycle before execute.
 * Public mint identity fields only — never private keys (those live on LaunchPlannedMint).
 */
export const launchOptionsOutcomesV1Schema = z.object({
  vanityMint: z.boolean(),
  removeAttribution: z.boolean(),
  /** Always set — public key of the planned mint for this Launch. */
  mintPublicKey: z.string().min(1),
  /** Always set — LaunchPlannedMint id used by execute to resolve the secret. */
  plannedMintId: z.string().min(1),
  /** Present when vanity pool sourcing was used; null for fresh planned mints. */
  reservedVanityMintId: z.string().nullable(),
});
export type LaunchOptionsOutcomesV1 = z.infer<
  typeof launchOptionsOutcomesV1Schema
>;

/**
 * Persisted Launch.plan envelope. shellVersion is stored on Launch.planSchemaVersion.
 * `money` is the lifecycle-composed summary (Platform money + Launch Options fees).
 * `platformPlan` stays opaque here — Platforms validate it with their own schema on execute/recover.
 */
export const launchPlanEnvelopeV1Schema = z.object({
  shellVersion: z.literal(LAUNCH_PLAN_SHELL_VERSION_V1),
  optionsOutcomes: launchOptionsOutcomesV1Schema,
  money: normalizedLaunchMoneySummarySchema,
  platformPlan: z.unknown(),
});
export type LaunchPlanEnvelopeV1 = z.infer<typeof launchPlanEnvelopeV1Schema>;

/**
 * Null Platform version marks a legacy Launch or Token.
 * Do not infer legacy status from JSON input shape.
 */
export function isLegacyPlatformRecord(record: {
  platformVersion: string | null | undefined;
}): boolean {
  return isLegacyPlatformVersion(record.platformVersion);
}
