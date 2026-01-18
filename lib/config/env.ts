import { z } from "zod";

const envSchema = z.object({
  SOLANA_RPC_URL: z.string().min(1),
  JITO_BLOCK_ENGINE_URL: z.string().min(1).optional().default("mainnet.block-engine.jito.wtf"),
});

export const env = envSchema.parse({
  SOLANA_RPC_URL: process.env.SOLANA_RPC_URL,
  JITO_BLOCK_ENGINE_URL: process.env.JITO_BLOCK_ENGINE_URL,
});

export type Env = z.infer<typeof envSchema>;
