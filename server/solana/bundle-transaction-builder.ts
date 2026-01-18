import {
  ComputeBudgetProgram,
  type Keypair,
  type PublicKey,
  Transaction,
  type TransactionInstruction,
} from "@solana/web3.js";
import { logger } from "@/lib/logger";
import { buildBuyTokenTransaction } from "@/server/solana/pump-transaction-builders";

const filterComputeBudget = (ixs: TransactionInstruction[]) =>
  ixs.filter((ix) => !ix.programId.equals(ComputeBudgetProgram.programId));

const BUNDLE_COMPUTE_UNITS = 800_000;

function formatError(reason: unknown) {
  if (reason instanceof Error) {
    return reason.message;
  }
  return typeof reason === "string" ? reason : String(reason);
}

export async function buildBundleTransactionsForCreateAndBuys(
  createTx: Transaction,
  createSigners: Keypair[],
  wallets: Keypair[],
  mint: PublicKey,
  buyAmountsLamport: bigint[],
  creator?: PublicKey
): Promise<[Transaction[], Keypair[][]]> {
  const logContext = {
    mint: mint.toBase58(),
    ...(creator ? { creator: creator.toBase58() } : {}),
  };
  if (wallets.length !== buyAmountsLamport.length) {
    throw new Error(
      `Bundle buy mismatch: wallets=${wallets.length}, amounts=${buyAmountsLamport.length}`
    );
  }
  if (wallets.length === 0) {
    const createOnlyTx = new Transaction();
    createOnlyTx.add(
      ComputeBudgetProgram.setComputeUnitLimit({ units: BUNDLE_COMPUTE_UNITS })
    );
    createOnlyTx.add(...filterComputeBudget(createTx.instructions));
    if (!createOnlyTx.feePayer) {
      createOnlyTx.feePayer = createSigners[0]?.publicKey;
    }
    return [[createOnlyTx], [createSigners]];
  }

  const bundleTransactions: Transaction[] = [];
  const bundleSigners: Keypair[][] = [];
  const firstTransactionBuyCount = Math.min(1, wallets.length);
  const buysPerTransaction = 3;

  const firstWallets = wallets.slice(0, firstTransactionBuyCount);
  const firstAmounts = buyAmountsLamport.slice(0, firstTransactionBuyCount);
  const firstBuyTxResults = await Promise.allSettled(
    firstWallets.map((wallet, i) =>
      buildBuyTokenTransaction(
        wallet,
        mint,
        firstAmounts[i],
        creator
      )
    )
  );
  const firstRejected = firstBuyTxResults.filter(
    (result): result is PromiseRejectedResult => result.status === "rejected"
  );
  if (firstRejected.length > 0) {
    logger.warn("Bundle buy instruction build failed", {
      ...logContext,
      failedCount: firstRejected.length,
      total: firstBuyTxResults.length,
      errors: firstRejected.map((result) => formatError(result.reason)).slice(0, 3),
    });
  }

  const firstTx = new Transaction();
  firstTx.add(
    ComputeBudgetProgram.setComputeUnitLimit({ units: BUNDLE_COMPUTE_UNITS })
  );
  firstTx.add(...filterComputeBudget(createTx.instructions));

  for (const result of firstBuyTxResults) {
    if (result.status === "fulfilled") {
      firstTx.add(...filterComputeBudget(result.value.instructions));
    }
  }

  firstTx.feePayer = firstWallets[0].publicKey;
  bundleTransactions.push(firstTx);
  bundleSigners.push([...createSigners, ...firstWallets]);

  for (
    let i = firstTransactionBuyCount;
    i < wallets.length;
    i += buysPerTransaction
  ) {
    const walletsSlice = wallets.slice(i, i + buysPerTransaction);
    const buyAmountsSlice = buyAmountsLamport.slice(i, i + buysPerTransaction);
    const tx = await buildBuyBundleTransaction(
      walletsSlice,
      mint,
      buyAmountsSlice,
      creator
    );
    bundleTransactions.push(tx);
    bundleSigners.push(walletsSlice);
  }

  return [bundleTransactions, bundleSigners];
}

async function buildBuyBundleTransaction(
  wallets: Keypair[],
  mint: PublicKey,
  buyAmountsLamport: bigint[],
  creator?: PublicKey
): Promise<Transaction> {
  const logContext = {
    mint: mint.toBase58(),
    ...(creator ? { creator: creator.toBase58() } : {}),
  };
  if (wallets.length !== buyAmountsLamport.length) {
    throw new Error(
      `Bundle buy mismatch: wallets=${wallets.length}, amounts=${buyAmountsLamport.length}`
    );
  }
  const buyTxResults = await Promise.allSettled(
    wallets.map((wallet, i) =>
      buildBuyTokenTransaction(
        wallet,
        mint,
        buyAmountsLamport[i],
        creator
      )
    )
  );
  const rejected = buyTxResults.filter(
    (result): result is PromiseRejectedResult => result.status === "rejected"
  );
  if (rejected.length > 0) {
    logger.warn("Bundle buy instruction build failed", {
      ...logContext,
      failedCount: rejected.length,
      total: buyTxResults.length,
      errors: rejected.map((result) => formatError(result.reason)).slice(0, 3),
    });
  }

  const outputTx = new Transaction();
  outputTx.add(
    ComputeBudgetProgram.setComputeUnitLimit({ units: BUNDLE_COMPUTE_UNITS })
  );
  for (const result of buyTxResults) {
    if (result.status === "fulfilled") {
      outputTx.add(...filterComputeBudget(result.value.instructions));
    }
  }

  outputTx.feePayer = wallets[0].publicKey;
  return outputTx;
}
