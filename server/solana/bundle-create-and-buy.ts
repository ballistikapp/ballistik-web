import { AnchorProvider } from "@coral-xyz/anchor";
import NodeWallet from "@coral-xyz/anchor/dist/cjs/nodewallet";
import { Keypair } from "@solana/web3.js";
import { PumpFunSDK, type CreateTokenMetadata } from "pumpdotfun-sdk";
import { logger } from "@/lib/logger";
import { getSolanaConnection } from "@/lib/solana/connection";
import { buildBundleTransactionsForCreateAndBuys } from "@/server/solana/bundle-transaction-builder";
import { sendJitoBundle } from "@/server/solana/jito-bundle";
import { buildCreateTokenTransaction } from "@/server/solana/pump-transaction-builders";

type BundleLaunchInput = {
  launchId?: string;
  creator: Keypair;
  mint: Keypair;
  metadata: CreateTokenMetadata;
  creatorBuyAmountLamport: bigint;
  buyerWallets: Keypair[];
  buyAmountsLamport: bigint[];
  tipper: Keypair;
  tipLamports: number;
};

function buildBundleBuyers(
  creator: Keypair,
  creatorBuyAmountLamport: bigint,
  buyerWallets: Keypair[],
  buyAmountsLamport: bigint[]
) {
  if (creatorBuyAmountLamport > BigInt(0)) {
    return {
      buyerWallets: [creator, ...buyerWallets],
      buyAmountsLamport: [creatorBuyAmountLamport, ...buyAmountsLamport],
    };
  }
  return { buyerWallets, buyAmountsLamport };
}

export async function createAndBuyInBundle(input: BundleLaunchInput) {
  const logContext = input.launchId ? { launchId: input.launchId } : {};
  if (input.buyerWallets.length !== input.buyAmountsLamport.length) {
    throw new Error(
      `Bundle buy mismatch: wallets=${input.buyerWallets.length}, amounts=${input.buyAmountsLamport.length}`
    );
  }
  logger.info("Bundle create/buy start", {
    ...logContext,
    buyerCount: input.buyerWallets.length,
    buyAmountCount: input.buyAmountsLamport.length,
    creatorBuyLamports: input.creatorBuyAmountLamport.toString(),
    tipLamports: input.tipLamports,
  });
  const provider = new AnchorProvider(
    getSolanaConnection(),
    new NodeWallet(input.creator),
    { commitment: "finalized" }
  );
  const pumpSdk = new PumpFunSDK(provider);
  const { createTx } = await buildCreateTokenTransaction(
    pumpSdk,
    input.creator,
    input.mint,
    input.metadata
  );

  const { buyerWallets, buyAmountsLamport } = buildBundleBuyers(
    input.creator,
    input.creatorBuyAmountLamport,
    input.buyerWallets,
    input.buyAmountsLamport
  );
  const totalBuyLamports = buyAmountsLamport.reduce(
    (total, amount) => total + amount,
    BigInt(0)
  );
  logger.info("Bundle buyers prepared", {
    ...logContext,
    buyerCount: buyerWallets.length,
    totalBuyLamports: totalBuyLamports.toString(),
  });

  const [txs, signers] = await buildBundleTransactionsForCreateAndBuys(
    createTx,
    [input.creator, input.mint],
    buyerWallets,
    input.mint.publicKey,
    buyAmountsLamport,
    input.creator.publicKey
  );
  logger.info("Bundle transactions built", {
    ...logContext,
    transactionCount: txs.length,
    signerGroups: signers.length,
  });

  try {
    const result = await sendJitoBundle(
      txs,
      signers,
      input.tipper,
      input.tipLamports
    );
    logger.info("Bundle confirmed", {
      ...logContext,
      bundleId: result.bundleId,
      signatureCount: result.signatures.length,
    });
    return result;
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : String(error);
    logger.error("Bundle send failed", {
      ...logContext,
      errorMessage,
      transactionCount: txs.length,
      buyerCount: buyerWallets.length,
    });
    throw error;
  }
}

