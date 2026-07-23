import { z } from "zod";
import { getEnv } from "@/lib/config/env";
import { getDefaultJitoBlockEngineUrl } from "@/lib/config/jito.config";

const launchConfigSchema = z.object({
  // Minimum buy amount per wallet (SOL).
  minBuyAmountSol: z.number().min(0),
  // Slippage basis points applied to pump.fun swaps.
  slippageBasisPoints: z.bigint().min(BigInt(0)),
  // Maximum bundler wallets allowed in a single bundle launch.
  maxBundleWallets: z.number().int().min(1),
  // Extra lamports added to each buy wallet for transaction fees.
  fundingBufferLamports: z.number().int().min(0),
  // Extra lamports reserved for token creation fees.
  createFeeBufferLamports: z.number().int().min(0),
  // Buffer for SOL transfer fees when funding wallets.
  transferFeeBufferLamports: z.number().int().min(0),
  // Max transfers per funding transaction batch.
  fundingBatchSize: z.number().int().min(1),
  // Launch job stale threshold (ms) before auto-fail.
  launchStaleMs: z.number().int().min(1),
  // Error message used when a launch becomes stale.
  launchStaleError: z.string().min(1),
  // Timeout for mint confirmation polling (ms).
  mintConfirmTimeoutMs: z.number().int().min(1),
  // Interval for mint confirmation polling (ms).
  mintConfirmIntervalMs: z.number().int().min(1),
  // Minimum creator wallet balance required (lamports).
  minCreatorBalanceLamports: z.bigint().min(BigInt(0)),
  // Solana RPC endpoint used for launch operations.
  solanaRpcUrl: z.string().min(1),
  // Jito block engine endpoint used for bundle submission.
  jitoBlockEngineUrl: z.string().min(1),
});

const baseLaunchConfig = {
  // Minimum buy amount per wallet (SOL).
  minBuyAmountSol: 0.05,
  // Slippage basis points applied to pump.fun swaps.
  slippageBasisPoints: BigInt(10000),
  // Maximum bundler wallets allowed in a single bundle launch.
  // Capped at 8 because the dev wallet always buys (min 0.05 SOL) and is
  // prepended to the bundle, giving 9 total buyers. With 2 buys per non-creator
  // transaction (see bundle-transaction-builder.ts) this fits Jito's 5-tx
  // bundle limit: tx1 = create + dev buy, tx2..tx5 = 2 bundler buys each.
  // Raise this once launch ALT support lands.
  maxBundleWallets: 8,
  // Extra lamports added to each buy wallet for transaction fees.
  fundingBufferLamports: 4_000_000,
  // Extra lamports reserved for token creation fees.
  createFeeBufferLamports: 20_000_000,
  // Buffer for SOL transfer fees when funding wallets.
  transferFeeBufferLamports: 10_000,
  // Max transfers per funding transaction batch.
  fundingBatchSize: 6,
  // Launch job stale threshold (ms) before auto-fail.
  launchStaleMs: 15 * 60 * 1000,
  // Error message used when a launch becomes stale.
  launchStaleError: "Launch stalled. Please recover funds and try again.",
  // Timeout for mint confirmation polling (ms).
  mintConfirmTimeoutMs: 120_000,
  // Interval for mint confirmation polling (ms).
  mintConfirmIntervalMs: 2_000,
  // Minimum creator wallet balance required (lamports).
  minCreatorBalanceLamports: BigInt(20_000_000),
};

/** Safe to import from client components — does not read env. */
export const MAX_BUNDLE_WALLETS = baseLaunchConfig.maxBundleWallets;
/** Safe to import from client components — does not read env. */
export const MIN_BUY_AMOUNT_SOL = baseLaunchConfig.minBuyAmountSol;

let cachedLaunchConfig: LaunchConfig | null = null;

export const getLaunchConfig = (): LaunchConfig => {
  if (cachedLaunchConfig) {
    return cachedLaunchConfig;
  }
  const env = getEnv();
  cachedLaunchConfig = launchConfigSchema.parse({
    ...baseLaunchConfig,
    solanaRpcUrl: env.SOLANA_RPC_URL,
    jitoBlockEngineUrl: getDefaultJitoBlockEngineUrl(),
  });
  return cachedLaunchConfig;
};

export type LaunchConfig = z.infer<typeof launchConfigSchema>;
