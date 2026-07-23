import {
  Keypair,
  TransactionMessage,
  VersionedTransaction,
  type AddressLookupTableAccount,
} from "@solana/web3.js";
import { logger } from "@/lib/logger";
import { getSolanaConnection } from "@/lib/solana/connection";
import {
  buildBundleTransactionsForCreateAndBuys,
  bundleBuyerTransactionIndex,
  bundleBuysPerFollowUpTransaction,
  type BundleBuyBuildFailure,
} from "@/server/solana/bundle-transaction-builder";
import {
  sendJitoBundle,
  type BundleTelemetryEvent,
} from "@/server/solana/jito-bundle";
import {
  buildCreateTokenTransaction,
  buildBuyTokenTransaction,
  type PumpMetadataUpload,
} from "@/server/solana/pump/transactions";
import {
  createDynamicLaunchAlt,
  computeLaunchAltAddresses,
} from "@/server/solana/pump/launch-alt";
import { appTransactionService } from "@/server/services/app-transaction.service";
import { settleSignature } from "@/server/services/app-transaction-settler";
import { mapPumpError } from "@/server/solana/pump/errors";

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
  isMayhemMode?: boolean;
  onBundleEvent?: (event: BundleTelemetryEvent) => void | Promise<void>;
  enableAdaptiveTip?: boolean;
  onBuyBuildFailures?: (
    failures: BundleBuyBuildFailure[]
  ) => void | Promise<void>;
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

// Bundle layout from buildBundleTransactionsForCreateAndBuys — buyer→tx
// mapping must use the shared packing helpers (ALT-aware buys per follow-up tx).
function buyerTxIndex(buyerIndex: number, hasAlt: boolean): number {
  return bundleBuyerTransactionIndex(
    buyerIndex,
    bundleBuysPerFollowUpTransaction(hasAlt)
  );
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
  const isMayhemMode = input.isMayhemMode ?? false;
  let altAccounts: AddressLookupTableAccount[] = [];
  if (isMayhemMode) {
    const altAddresses = await computeLaunchAltAddresses(
      input.mint.publicKey,
      input.creator.publicKey,
      { isMayhemMode: true }
    );
    const alt = await createDynamicLaunchAlt(input.creator, altAddresses, logContext);
    altAccounts = [alt];
    logger.info("Mayhem launch ALT ready for bundle", {
      ...logContext,
      altAddress: alt.key.toBase58(),
      addressCount: alt.state.addresses.length,
    });
  }

  const { createTx, metadataUri } = await buildCreateTokenTransaction(
    input.creator,
    input.mint,
    input.metadata,
    { isMayhemMode }
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
    const combined = `${JSON.stringify(simulationResult.value.err)}\n${(simulationResult.value.logs ?? []).join("\n")}`;
    const mapped = mapPumpError(combined);
    if (mapped) throw mapped;
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

  const [txs, signers, buyBuildFailures] = await buildBundleTransactionsForCreateAndBuys(
    createTx,
    [input.creator, input.mint],
    buyerWallets,
    input.mint.publicKey,
    buyAmountsLamport,
    input.creator.publicKey,
    {
      launchId: input.launchId,
      altAccounts,
      ...(isMayhemMode
        ? {
            buildBuyTransaction: (buyer, mint, amount, creator) =>
              buildBuyTokenTransaction(
                buyer,
                mint,
                amount,
                creator,
                undefined,
                { isMayhemMode: true }
              ),
          }
        : {}),
    }
  );
  if (buyBuildFailures.length > 0) {
    logger.warn("Bundle buy build completed with failures", {
      ...logContext,
      configuredBuyers: buyerWallets.length,
      failedCount: buyBuildFailures.length,
      failures: buyBuildFailures,
    });
    await input.onBuyBuildFailures?.(buyBuildFailures);
  }
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
  const hasAlt = altAccounts.length > 0;

  type TrackedRow = { id: string; walletPublicKey: string; txIndex: number };
  const trackedRows: TrackedRow[] = [];

  if (input.userId) {
    // Buyer rows (one per buyer per their tx)
    for (let i = 0; i < buyerWallets.length; i += 1) {
      const buyerPk = buyerWallets[i].publicKey.toBase58();
      const txIndex = Math.min(buyerTxIndex(i, hasAlt), lastTxIndex);
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
        enableAdaptiveTip: input.enableAdaptiveTip,
        launchId: input.launchId,
        altAccounts,
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
