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
import { settleSignature } from "@/server/services/app-transaction-settler";

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
      creatorIsBuyer: true,
    };
  }
  return {
    buyerWallets,
    buyAmountsLamport,
    creatorIsBuyer: false,
  };
}

// Bundle layout from buildBundleTransactionsForCreateAndBuys:
//   tx[0] = create + first buyer
//   tx[i>=1] = next 3 buyers each
function buyerTxIndex(buyerIndex: number): number {
  if (buyerIndex === 0) return 0;
  return 1 + Math.floor((buyerIndex - 1) / 3);
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

  const { buyerWallets, buyAmountsLamport, creatorIsBuyer } = buildBundleBuyers(
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

  const txCount = txs.length;
  const lastTxIndex = txCount - 1;
  const mintPk = input.mint.publicKey.toBase58();
  const creatorPk = input.creator.publicKey.toBase58();
  const tipperPk = input.tipper.publicKey.toBase58();

  type TrackedRow = { id: string; walletPublicKey: string; txIndex: number };
  const trackedRows: TrackedRow[] = [];

  if (input.userId) {
    // Buyer rows (one per buyer per their tx)
    for (let i = 0; i < buyerWallets.length; i += 1) {
      const buyerPk = buyerWallets[i].publicKey.toBase58();
      const txIndex = Math.min(buyerTxIndex(i), lastTxIndex);
      const intent = Number(buyAmountsLamport[i]) / 1_000_000_000;
      const id = await appTransactionService
        .create({
          userId: input.userId,
          type: "TRADE_BUY",
          source: "LAUNCH",
          tokenPublicKey: mintPk,
          walletPublicKey: buyerPk,
          fromAddress: buyerPk,
          intentSolAmount: intent,
          referenceId: input.launchId,
        })
        .then((r) => r.id)
        .catch(() => null);
      if (id) trackedRows.push({ id, walletPublicKey: buyerPk, txIndex });
    }

    // Creator-only TRADE_CREATE row when creator is not also a buyer
    if (!creatorIsBuyer) {
      const id = await appTransactionService
        .create({
          userId: input.userId,
          type: "TRADE_CREATE",
          source: "LAUNCH",
          tokenPublicKey: mintPk,
          walletPublicKey: creatorPk,
          fromAddress: creatorPk,
          referenceId: input.launchId,
        })
        .then((r) => r.id)
        .catch(() => null);
      if (id) trackedRows.push({ id, walletPublicKey: creatorPk, txIndex: 0 });
    }

    // Jito tip row on the tipper for the last tx, but only when the tipper
    // does not already have a row on that tx (would violate unique
    // [transactionSignature, walletPublicKey]). When it would conflict, the
    // tip cost is naturally captured in the tipper's other row's wallet delta.
    if (input.tipLamports > 0) {
      const tipperAlreadyOnLastTx = trackedRows.some(
        (r) => r.txIndex === lastTxIndex && r.walletPublicKey === tipperPk
      );
      if (!tipperAlreadyOnLastTx) {
        const id = await appTransactionService
          .create({
            userId: input.userId,
            type: "JITO_TIP",
            source: "LAUNCH",
            tokenPublicKey: mintPk,
            walletPublicKey: tipperPk,
            fromAddress: tipperPk,
            intentSolAmount: input.tipLamports / 1_000_000_000,
            referenceId: input.launchId,
          })
          .then((r) => r.id)
          .catch(() => null);
        if (id)
          trackedRows.push({
            id,
            walletPublicKey: tipperPk,
            txIndex: lastTxIndex,
          });
      }
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

    if (trackedRows.length > 0) {
      const byTx = new Map<number, TrackedRow[]>();
      for (const row of trackedRows) {
        const existing = byTx.get(row.txIndex) ?? [];
        existing.push(row);
        byTx.set(row.txIndex, existing);
      }
      for (const [txIndex, rows] of byTx) {
        const signature = result.signatures[txIndex];
        if (!signature) continue;
        await appTransactionService
          .confirmMany(
            rows.map((r) => r.id),
            { signature }
          )
          .catch(() => {});
        await settleSignature({
          signature,
          rows: rows.map((r) => ({ id: r.id, walletPublicKey: r.walletPublicKey })),
          connection,
        }).catch(() => {});
      }
    }

    logger.info("Bundle confirmed", {
      ...logContext,
      bundleId: result.bundleId,
      signatureCount: result.signatures.length,
    });
    return result;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    if (trackedRows.length > 0) {
      await appTransactionService
        .failMany(
          trackedRows.map((r) => r.id),
          { errorMessage }
        )
        .catch(() => {});
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
