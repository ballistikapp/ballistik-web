import { z } from "zod";

const envSchema = z.object({
  SOLANA_RPC_URL: z.string().min(1),
  SHYFT_API_KEY: z.string().min(1).optional(),
});

let cachedEnv: Env | null = null;

export const getEnv = (): Env => {
  if (cachedEnv) {
    return cachedEnv;
  }
  cachedEnv = envSchema.parse({
    SOLANA_RPC_URL: process.env.SOLANA_RPC_URL,
    SHYFT_API_KEY: process.env.SHYFT_API_KEY,
  });
  return cachedEnv;
};

export type Env = z.infer<typeof envSchema>;
