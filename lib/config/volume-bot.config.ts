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
  maxLossPerWalletSol: z.number().min(0),
  maxTotalLossSol: z.number().min(0),
  slippageBps: z.number().int().min(0),
  maxConcurrentTicks: z.number().int().min(1),
  tickStaleMs: z.number().int().min(1),
  maxDurationHours: z.number().min(1),
  orphanedSessionTimeoutMs: z.number().int().min(1),
  solanaRpcUrl: z.string().min(1),
});

const baseVolumeBotConfig = {
  minWallets: 1,
  maxWallets: 50,
  minFundingPerWalletSol: 0.001,
  minTradeAmountSol: 0.001,
  maxTradeAmountSol: 1,
  minIntervalSeconds: 10,
  maxIntervalSeconds: 3600,
  maxLossPerWalletSol: 0.1,
  maxTotalLossSol: 5,
  slippageBps: 1000,
  maxConcurrentTicks: 6,
  tickStaleMs: 10 * 60 * 1000,
  maxDurationHours: 168, // 7 days max
  orphanedSessionTimeoutMs: 30 * 60 * 1000, // 30 minutes without activity = orphaned
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
