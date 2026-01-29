import { z } from "zod";
import { getVolumeBotConfig } from "@/lib/config/volume-bot.config";

export const volumeBotRangeDirectionSchema = z.enum(["buy", "sell", "both"]);

export const volumeBotRangeSchema = z
  .object({
    solMin: z.number().min(0),
    solMax: z.number().min(0),
    increment: z.number().nullable().optional(),
    probability: z.number().min(0).max(1),
    intervalMin: z.number().int().min(1),
    intervalMax: z.number().int().min(1),
    direction: volumeBotRangeDirectionSchema,
    buyProbability: z.number().min(0).max(1).optional(),
  })
  .superRefine((range, ctx) => {
    if (range.solMin < 0.001) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "solMin must be >= 0.001",
        path: ["solMin"],
      });
    }
    if (range.solMax > 10) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "solMax must be <= 10",
        path: ["solMax"],
      });
    }
    if (range.solMin > range.solMax) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "solMin cannot exceed solMax",
        path: ["solMin"],
      });
    }
    if (range.intervalMax > 3600) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "intervalMax must be <= 3600",
        path: ["intervalMax"],
      });
    }
    if (range.intervalMin > range.intervalMax) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "intervalMin cannot exceed intervalMax",
        path: ["intervalMin"],
      });
    }
    if (range.direction === "both" && typeof range.buyProbability !== "number") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "buyProbability is required when direction is both",
        path: ["buyProbability"],
      });
    }
    if (range.increment !== null && range.increment !== undefined) {
      if (!Number.isFinite(range.increment) || range.increment <= 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "increment must be > 0 when provided",
          path: ["increment"],
        });
      } else {
        const steps =
          Math.floor((range.solMax - range.solMin) / range.increment + 1e-9) + 1;
        if (steps < 2) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "increment must yield at least 2 steps",
            path: ["increment"],
          });
        }
      }
    }
  });

export const volumeBotWalletConfigSchema = z.object({
  generatedWalletCount: z.number().int().min(0),
  selectedWalletPublicKeys: z.array(z.string().min(1)).default([]),
  fundingPerGeneratedWallet: z.number().min(0),
  topUpAmount: z.number().min(0),
});

export const volumeBotBehaviorConfigSchema = z.object({
  slippageBps: z.number().int().min(0),
  sellFallbackRatio: z.number().min(0).max(1),
  pauseOnHighSlippage: z.boolean(),
  maxSlippageFailures: z.number().int().min(1),
  priorityFeeMicroLamports: z.number().int().min(0).optional(),
  computeUnitLimit: z.number().int().min(50_000).max(1_400_000).optional(),
  maxRetries: z.number().int().min(0).max(5).optional(),
});

export const volumeBotConfigSchema = z
  .object({
    ranges: z.array(volumeBotRangeSchema),
    walletConfig: volumeBotWalletConfigSchema,
    behaviorConfig: volumeBotBehaviorConfigSchema,
    targetDurationSeconds: z.number().int().min(1),
  })
  .superRefine((config, ctx) => {
    const limits = getVolumeBotConfig();
    if (config.ranges.length < limits.minRanges) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `At least ${limits.minRanges} range required`,
        path: ["ranges"],
      });
    }
    if (config.ranges.length > limits.maxRanges) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `No more than ${limits.maxRanges} ranges allowed`,
        path: ["ranges"],
      });
    }
    const probabilitySum = config.ranges.reduce(
      (sum, range) => sum + range.probability,
      0
    );
    if (Math.abs(probabilitySum - 1) >= 0.001) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Range probabilities must sum to 1.0",
        path: ["ranges"],
      });
    }
    for (const range of config.ranges) {
      if (range.probability < limits.minRangeProbability) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Range probability must be >= ${limits.minRangeProbability}`,
          path: ["ranges"],
        });
        break;
      }
      if (range.probability > limits.maxRangeProbability) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Range probability must be <= ${limits.maxRangeProbability}`,
          path: ["ranges"],
        });
        break;
      }
    }
    if (config.walletConfig.fundingPerGeneratedWallet < limits.minFundingPerWalletSol) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Funding per wallet too low",
        path: ["walletConfig", "fundingPerGeneratedWallet"],
      });
    }
    const totalWalletCount =
      config.walletConfig.generatedWalletCount +
      config.walletConfig.selectedWalletPublicKeys.length;
    if (
      totalWalletCount < limits.minWallets ||
      totalWalletCount > limits.maxWallets
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Wallet count out of bounds",
        path: ["walletConfig"],
      });
    }
    if (config.targetDurationSeconds > limits.maxDurationSeconds) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Duration exceeds maximum of ${limits.maxDurationHours} hours`,
        path: ["targetDurationSeconds"],
      });
    }
    const minInterval = Math.min(...config.ranges.map((r) => r.intervalMin));
    const maxTradesPerSec = 18;
    const maxWalletsForInterval = Math.floor(maxTradesPerSec * minInterval);
    if (totalWalletCount > maxWalletsForInterval && minInterval < 5) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `With ${minInterval}s intervals, max ${maxWalletsForInterval} wallets allowed`,
        path: ["walletConfig"],
      });
    }
  });

export const volumeBotSelectionSummarySchema = z.object({
  tokenPublicKey: z.string().min(1),
  config: volumeBotConfigSchema,
});

export const volumeBotEligibleWalletsSchema = z.object({
  tokenPublicKey: z.string().min(1),
});

export const startVolumeBotSchema = z.object({
  tokenPublicKey: z.string().min(1),
  config: volumeBotConfigSchema,
  scheduledStartAt: z.date().optional(),
  scheduledStopAt: z.date().optional(),
});

export const volumeBotStatusSchema = z.object({
  sessionId: z.string().optional(),
  tokenPublicKey: z.string().optional(),
});

export const stopVolumeBotSchema = z.object({
  sessionId: z.string().min(1),
});

export const reclaimVolumeBotSchema = z.object({
  sessionId: z.string().min(1),
});

export const closeVolumeBotAccountsSchema = z.object({
  sessionId: z.string().min(1),
});

export const listVolumeBotSessionsSchema = z.object({
  tokenPublicKey: z.string().optional(),
  limit: z.number().int().min(1).max(50).default(10),
});

export const listVolumeBotPresetsSchema = z.object({});

export const saveVolumeBotPresetSchema = z.object({
  name: z.string().min(1),
  config: volumeBotConfigSchema,
});

export const deleteVolumeBotPresetSchema = z.object({
  presetId: z.string().min(1),
});

export type VolumeBotConfigInput = z.infer<typeof volumeBotConfigSchema>;
export type StartVolumeBotInput = z.infer<typeof startVolumeBotSchema>;
export type VolumeBotStatusInput = z.infer<typeof volumeBotStatusSchema>;
export type StopVolumeBotInput = z.infer<typeof stopVolumeBotSchema>;
export type ReclaimVolumeBotInput = z.infer<typeof reclaimVolumeBotSchema>;
export type CloseVolumeBotAccountsInput = z.infer<
  typeof closeVolumeBotAccountsSchema
>;
export type ListVolumeBotSessionsInput = z.infer<
  typeof listVolumeBotSessionsSchema
>;
export type ListVolumeBotPresetsInput = z.infer<
  typeof listVolumeBotPresetsSchema
>;
export type SaveVolumeBotPresetInput = z.infer<
  typeof saveVolumeBotPresetSchema
>;
export type DeleteVolumeBotPresetInput = z.infer<
  typeof deleteVolumeBotPresetSchema
>;
export type VolumeBotSelectionSummaryInput = z.infer<
  typeof volumeBotSelectionSummarySchema
>;
export type VolumeBotEligibleWalletsInput = z.infer<
  typeof volumeBotEligibleWalletsSchema
>;
