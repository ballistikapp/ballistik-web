import { config as loadEnv } from "dotenv";
import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  SOLANA_RPC_URL: z.string().min(1),
  SHYFT_API_KEY: z.string().min(1),
  SHYFT_GRPC_TOKEN: z.string().min(1).optional(),
  GRPC_ACCESS_MODE: z.enum(["off", "pro", "all"]).default("pro"),
  SHYFT_CALLBACK_SECRET: z.string().min(1).optional(),
  JWT_SECRET: z.string().min(1),
  JWT_EXPIRATION: z.string().min(1).optional(),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(7),
  SESSION_MAX_TTL_DAYS: z.coerce.number().int().positive().optional(),
  PINATA_JWT: z.string().min(1),
  PINATA_GATEWAY_URL: z.string().url(),
  MONITORING_PIPELINE_V2: z
    .string()
    .optional()
    .transform((value) => value !== "false"),
  APP_URL: z.string().url(),
  FEE_COLLECTOR_WALLET_ADDRESS: z.string().min(1),
});

const dbEnvSchema = z.object({
  DATABASE_URL: z.string().min(1),
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
    loadEnv({ path, override: false, quiet: true });
  });
};

export const getEnv = (): Env => {
  if (cachedEnv) {
    return cachedEnv;
  }
  loadEnvFiles();
  cachedEnv = envSchema.parse({
    DATABASE_URL: process.env.DATABASE_URL,
    SOLANA_RPC_URL: process.env.SOLANA_RPC_URL,
    SHYFT_API_KEY: process.env.SHYFT_API_KEY,
    SHYFT_GRPC_TOKEN: process.env.SHYFT_GRPC_TOKEN,
    GRPC_ACCESS_MODE: process.env.GRPC_ACCESS_MODE,
    SHYFT_CALLBACK_SECRET: process.env.SHYFT_CALLBACK_SECRET,
    JWT_SECRET: process.env.JWT_SECRET,
    JWT_EXPIRATION: process.env.JWT_EXPIRATION,
    REFRESH_TOKEN_TTL_DAYS: process.env.REFRESH_TOKEN_TTL_DAYS,
    SESSION_MAX_TTL_DAYS: process.env.SESSION_MAX_TTL_DAYS,
    PINATA_JWT: process.env.PINATA_JWT,
    PINATA_GATEWAY_URL: process.env.PINATA_GATEWAY_URL,
    MONITORING_PIPELINE_V2: process.env.MONITORING_PIPELINE_V2,
    APP_URL: process.env.APP_URL,
    FEE_COLLECTOR_WALLET_ADDRESS: process.env.FEE_COLLECTOR_WALLET_ADDRESS,
  });
  return cachedEnv;
};

export type Env = z.infer<typeof envSchema>;

export const getDatabaseUrl = (): string => {
  loadEnvFiles();
  if (cachedDbEnv) {
    return cachedDbEnv.DATABASE_URL;
  }
  cachedDbEnv = dbEnvSchema.parse({
    DATABASE_URL: process.env.DATABASE_URL,
  });
  return cachedDbEnv.DATABASE_URL;
};

export type DbEnv = z.infer<typeof dbEnvSchema>;
