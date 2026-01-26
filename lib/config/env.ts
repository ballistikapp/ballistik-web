import { config as loadEnv } from "dotenv";
import { z } from "zod";

const envSchema = z.object({
  SOLANA_RPC_URL: z.string().min(1),
  SHYFT_API_KEY: z.string().min(1).optional(),
});

const dbEnvSchema = z.object({
  DATABASE_URL: z.string().min(1).optional(),
  DEV_STORAGE_POSTGRES_URL: z.string().min(1).optional(),
  PROD_STORAGE_POSTGRES_URL: z.string().min(1).optional(),
});

let cachedEnv: Env | null = null;
let cachedDbEnv: DbEnv | null = null;
let envLoaded = false;

const loadEnvFiles = () => {
  if (envLoaded) return;
  envLoaded = true;

  const nodeEnv = process.env.NODE_ENV ?? "development";
  const envFiles = [
    `.env.${nodeEnv}.local`,
    ".env.local",
    `.env.${nodeEnv}`,
    ".env",
  ];

  if (nodeEnv === "production") {
    envFiles.push(".env.development.local", ".env.development");
  }

  envFiles.forEach((path) => {
    loadEnv({ path, override: false });
  });
};

export const getEnv = (): Env => {
  if (cachedEnv) {
    return cachedEnv;
  }
  loadEnvFiles();
  cachedEnv = envSchema.parse({
    SOLANA_RPC_URL: process.env.SOLANA_RPC_URL,
    SHYFT_API_KEY: process.env.SHYFT_API_KEY,
  });
  return cachedEnv;
};

export type Env = z.infer<typeof envSchema>;

export const getDatabaseUrl = (): string | null => {
  loadEnvFiles();
  if (!cachedDbEnv) {
    cachedDbEnv = dbEnvSchema.parse({
      DATABASE_URL: process.env.DATABASE_URL,
      DEV_STORAGE_POSTGRES_URL: process.env.DEV_STORAGE_POSTGRES_URL,
      PROD_STORAGE_POSTGRES_URL: process.env.PROD_STORAGE_POSTGRES_URL,
    });
  }

  return (
    cachedDbEnv.DEV_STORAGE_POSTGRES_URL ??
    cachedDbEnv.DATABASE_URL ??
    cachedDbEnv.PROD_STORAGE_POSTGRES_URL ??
    null
  );
};

export type DbEnv = z.infer<typeof dbEnvSchema>;
