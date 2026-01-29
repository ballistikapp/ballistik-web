import { z } from "zod";
import { getEnv } from "@/lib/config/env";

const volumeBotConfigSchema = z.object({
  minWallets: z.number().int().min(1),
  maxWallets: z.number().int().min(1),
  minFundingPerWalletSol: z.number().min(0),
  minTradeAmountSol: z.number().min(0),
  maxTradeAmountSol: z.number().min(0),
  minIntervalSeconds: z.number().int().min(1),
  maxIntervalSeconds: z.number().int().min(1),
  minRanges: z.number().int().min(1),
  maxRanges: z.number().int().min(1),
  minRangeProbability: z.number().min(0),
  maxRangeProbability: z.number().min(0),
  slippageBps: z.number().int().min(0),
  maxConcurrentTicks: z.number().int().min(1),
  tickStaleMs: z.number().int().min(1),
  maxDurationHours: z.number().min(1),
  maxDurationSeconds: z.number().int().min(60),
  orphanedSessionTimeoutMs: z.number().int().min(1),
  solanaRpcUrl: z.string().min(1),
  defaultPriorityFeeMicroLamports: z.number().int().min(0),
  defaultComputeUnitLimit: z.number().int().min(50_000).max(1_400_000),
  defaultMaxRetries: z.number().int().min(0).max(5),
});

const baseVolumeBotConfig = {
  minWallets: 1,
  maxWallets: 50,
  minFundingPerWalletSol: 0.001,
  minTradeAmountSol: 0.001,
  maxTradeAmountSol: 10,
  minIntervalSeconds: 1,
  maxIntervalSeconds: 3600,
  minRanges: 1,
  maxRanges: 5,
  minRangeProbability: 0.01,
  maxRangeProbability: 1.0,
  slippageBps: 1000,
  maxConcurrentTicks: 6,
  tickStaleMs: 10 * 60 * 1000,
  maxDurationHours: 168, // 7 days max
  maxDurationSeconds: 168 * 60 * 60,
  orphanedSessionTimeoutMs: 30 * 60 * 1000, // 30 minutes without activity = orphaned
  defaultPriorityFeeMicroLamports: 50_000, // 0.00005 SOL per CU - reasonable default
  defaultComputeUnitLimit: 200_000, // Standard pump.fun trade uses ~150k
  defaultMaxRetries: 2, // Retry twice on block height exceeded
};

let cachedVolumeBotConfig: VolumeBotConfig | null = null;

export const getVolumeBotConfig = (): VolumeBotConfig => {
  if (cachedVolumeBotConfig) {
    return cachedVolumeBotConfig;
  }
  const env = getEnv();
  cachedVolumeBotConfig = volumeBotConfigSchema.parse({
    ...baseVolumeBotConfig,
    solanaRpcUrl: env.SOLANA_RPC_URL,
  });
  return cachedVolumeBotConfig;
};

export type VolumeBotConfig = z.infer<typeof volumeBotConfigSchema>;
