import { z } from "zod";
import { env } from "@/lib/config/env";

const launchConfigSchema = z.object({
  minBuyAmountSol: z.number().min(0),
  slippageBasisPoints: z.bigint().min(BigInt(0)),
  maxBundleWallets: z.number().int().min(1),
  solanaRpcUrl: z.string().min(1),
  jitoBlockEngineUrl: z.string().min(1),
});

export const launchConfig = launchConfigSchema.parse({
  minBuyAmountSol: 0.003,
  slippageBasisPoints: BigInt(10000),
  maxBundleWallets: 11,
  solanaRpcUrl: env.SOLANA_RPC_URL,
  jitoBlockEngineUrl: env.JITO_BLOCK_ENGINE_URL,
});

export type LaunchConfig = z.infer<typeof launchConfigSchema>;
