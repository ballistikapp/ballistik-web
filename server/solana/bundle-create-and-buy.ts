import {
  Keypair,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { logger } from "@/lib/logger";
import { getSolanaConnection } from "@/lib/solana/connection";
import { buildBundleTransactionsForCreateAndBuys } from "@/server/solana/bundle-transaction-builder";
import { sendJitoBundle } from "@/server/solana/jito-bundle";
import {
  buildCreateTokenTransaction,
  type PumpMetadataUpload,
} from "@/server/solana/pump-transaction-builders";

type BundleLaunchInput = {
  launchId?: string;
  creator: Keypair;
  mint: Keypair;
  metadata: PumpMetadataUpload;
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
  const { createTx, metadataUri } = await buildCreateTokenTransaction(
    input.creator,
    input.mint,
    input.metadata
  );
  logger.info("Create transaction prepared", {
    ...logContext,
    feePayer: createTx.feePayer?.toBase58(),
    instructionCount: createTx.instructions.length,
    metadataUriLength: metadataUri?.length ?? 0,
    metadataUriPrefix: metadataUri ? metadataUri.slice(0, 32) : null,
  });
  const connection = getSolanaConnection();
  if (!createTx.feePayer) {
    createTx.feePayer = input.creator.publicKey;
  }
  const { blockhash } = await connection.getLatestBlockhash("confirmed");
  logger.info("Create simulation start", {
    ...logContext,
    blockhash,
  });
  const createMessage = new TransactionMessage({
    payerKey: createTx.feePayer,
    recentBlockhash: blockhash,
    instructions: createTx.instructions,
  }).compileToV0Message();
  const createSimulationTx = new VersionedTransaction(createMessage);
  createSimulationTx.sign([input.creator, input.mint]);
  const simulationResult = await connection.simulateTransaction(
    createSimulationTx,
    { sigVerify: false, commitment: "processed" }
  );
  if (simulationResult.value.err) {
    logger.error("Create simulation failed", {
      ...logContext,
      error: simulationResult.value.err,
      logs: simulationResult.value.logs?.slice(0, 30),
    });
    throw new Error(
      `Create simulation failed: ${JSON.stringify(simulationResult.value.err)}`
    );
  }
  logger.info("Create simulation succeeded", {
    ...logContext,
    unitsConsumed: simulationResult.value.unitsConsumed ?? null,
  });

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
    instructionCounts: txs.map((tx) => tx.instructions.length),
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
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error("Bundle send failed", {
      ...logContext,
      errorMessage,
      transactionCount: txs.length,
      buyerCount: buyerWallets.length,
    });
    throw error;
  }
}
