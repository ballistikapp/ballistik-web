import {
  Keypair,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { logger } from "@/lib/logger";
import { getSolanaConnection } from "@/lib/solana/connection";
import { buildBundleTransactionsForCreateAndBuys } from "@/server/solana/bundle-transaction-builder";
import {
  sendJitoBundle,
  type BundleTelemetryEvent,
} from "@/server/solana/jito-bundle";
import {
  buildCreateTokenTransaction,
  type PumpMetadataUpload,
} from "@/server/solana/pump-transaction-builders";
import { appTransactionService } from "@/server/services/app-transaction.service";

type BundleLaunchInput = {
  launchId?: string;
  userId?: string;
  creator: Keypair;
  mint: Keypair;
  metadata: PumpMetadataUpload;
  creatorBuyAmountLamport: bigint;
  buyerWallets: Keypair[];
  buyAmountsLamport: bigint[];
  tipper: Keypair;
  tipLamports: number;
  enableGrpc?: boolean;
  onBundleEvent?: (event: BundleTelemetryEvent) => void | Promise<void>;
  adaptiveTipEscalation?: {
    enabled?: boolean;
    multiplier?: number;
    maxEscalations?: number;
  };
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

  const createTrackId = input.userId
    ? await appTransactionService.create({
        userId: input.userId,
        type: "TRADE_CREATE",
        source: "LAUNCH",
        tokenPublicKey: input.mint.publicKey.toBase58(),
        walletPublicKey: input.creator.publicKey.toBase58(),
        fromAddress: input.creator.publicKey.toBase58(),
        referenceId: input.launchId,
      }).then((r) => r.id).catch(() => null)
    : null;

  const buyTrackIds: string[] = [];
  if (input.userId) {
    for (let i = 0; i < buyerWallets.length; i++) {
      const id = await appTransactionService.create({
        userId: input.userId,
        type: "TRADE_BUY",
        source: "LAUNCH",
        tokenPublicKey: input.mint.publicKey.toBase58(),
        walletPublicKey: buyerWallets[i].publicKey.toBase58(),
        fromAddress: buyerWallets[i].publicKey.toBase58(),
        solAmount: Number(buyAmountsLamport[i]) / 1_000_000_000,
        referenceId: input.launchId,
      }).then((r) => r.id).catch(() => null);
      if (id) buyTrackIds.push(id);
    }
  }

  try {
    const result = await sendJitoBundle(
      txs,
      signers,
      input.tipper,
      input.tipLamports,
      {
        enableGrpc: input.enableGrpc,
        onEvent: input.onBundleEvent,
        adaptiveTipEscalation: input.adaptiveTipEscalation,
      }
    );
    if (createTrackId && result.signatures[0]) {
      await appTransactionService.confirm(createTrackId, { signature: result.signatures[0] }).catch(() => {});
    }
    const allBuyIds = buyTrackIds;
    if (allBuyIds.length > 0 && result.signatures.length > 0) {
      const bundleSig = result.signatures[result.signatures.length - 1] ?? result.signatures[0];
      await appTransactionService.confirmMany(allBuyIds, { signature: bundleSig }).catch(() => {});
    }
    logger.info("Bundle confirmed", {
      ...logContext,
      bundleId: result.bundleId,
      signatureCount: result.signatures.length,
    });
    return result;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const allTrackIds = [createTrackId, ...buyTrackIds].filter(Boolean) as string[];
    if (allTrackIds.length > 0) {
      await appTransactionService.failMany(allTrackIds, { errorMessage }).catch(() => {});
    }
    logger.error("Bundle send failed", {
      ...logContext,
      errorMessage,
      transactionCount: txs.length,
      buyerCount: buyerWallets.length,
    });
    throw error;
  }
}
