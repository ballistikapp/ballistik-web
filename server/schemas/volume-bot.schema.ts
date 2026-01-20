import { z } from "zod";

export const volumeBotStrategySchema = z.enum(["neutral", "pump", "dump"]);

export const volumeBotConfigSchema = z.object({
  walletCount: z.number().int().min(1),
  fundingPerWalletSol: z.number().min(0),
  minTradeAmountSol: z.number().min(0),
  maxTradeAmountSol: z.number().min(0),
  minIntervalSeconds: z.number().int().min(1),
  maxIntervalSeconds: z.number().int().min(1),
  sellRatio: z.number().min(0).max(1),
  strategy: volumeBotStrategySchema,
  maxLossPerWalletSol: z.number().min(0),
  maxTotalLossSol: z.number().min(0),
  slippageBps: z.number().int().min(0),
  targetVolumePerHour: z.number().min(0).optional(),
  targetDurationHours: z.number().min(0).optional(),
  sellOnStop: z.boolean().default(true),
});

export const startVolumeBotSchema = z.object({
  tokenPublicKey: z.string().min(1),
  config: volumeBotConfigSchema,
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
