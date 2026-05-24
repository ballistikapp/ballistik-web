import {
  ComputeBudgetProgram,
  type Keypair,
  type PublicKey,
  Transaction,
  TransactionMessage,
  VersionedTransaction,
  type TransactionInstruction,
} from "@solana/web3.js";
import { ASSOCIATED_TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { logger } from "@/lib/logger";
import { buildBuyTokenTransaction } from "@/server/solana/pump/transactions";

const filterComputeBudget = (ixs: TransactionInstruction[]) =>
  ixs.filter((ix) => !ix.programId.equals(ComputeBudgetProgram.programId));

const BUNDLE_COMPUTE_UNITS = 800_000;
const MAX_RAW_TRANSACTION_BYTES = 1232;
const SIZE_ESTIMATE_BLOCKHASH = "11111111111111111111111111111111";

function addBundleComputeBudget(tx: Transaction) {
  tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: BUNDLE_COMPUTE_UNITS }));
}

function dedupeSigners(signers: Keypair[]) {
  const seen = new Set<string>();
  return signers.filter((signer) => {
    const key = signer.publicKey.toBase58();
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function estimateVersionedTransactionSize(
  tx: Transaction,
  signers: Keypair[]
) {
  if (!tx.feePayer) {
    throw new Error("Cannot estimate size for transaction without fee payer");
  }

  const message = new TransactionMessage({
    payerKey: tx.feePayer,
    recentBlockhash: SIZE_ESTIMATE_BLOCKHASH,
    instructions: tx.instructions,
  }).compileToV0Message();
  const versionedTx = new VersionedTransaction(message);
  versionedTx.sign(dedupeSigners(signers));
  return versionedTx.serialize().length;
}

function formatError(reason: unknown) {
  if (reason instanceof Error) {
    return reason.message;
  }
  return typeof reason === "string" ? reason : String(reason);
}

function splitAtaCreateInstructions(ixs: TransactionInstruction[]) {
  const ataCreateInstructions: TransactionInstruction[] = [];
  const remainingInstructions: TransactionInstruction[] = [];

  for (const instruction of ixs) {
    if (instruction.programId.equals(ASSOCIATED_TOKEN_PROGRAM_ID)) {
      ataCreateInstructions.push(instruction);
      continue;
    }
    remainingInstructions.push(instruction);
  }

  return {
    ataCreateInstructions,
    remainingInstructions,
  };
}

type BuildBuyTransaction = typeof buildBuyTokenTransaction;

export async function buildBundleTransactionsForCreateAndBuys(
  createTx: Transaction,
  createSigners: Keypair[],
  wallets: Keypair[],
  mint: PublicKey,
  buyAmountsLamport: bigint[],
  creator?: PublicKey,
  options?: {
    buildBuyTransaction?: BuildBuyTransaction;
  }
): Promise<[Transaction[], Keypair[][]]> {
  const logContext = {
    mint: mint.toBase58(),
    ...(creator ? { creator: creator.toBase58() } : {}),
  };
  const buildBuyTransaction =
    options?.buildBuyTransaction ?? buildBuyTokenTransaction;
  if (wallets.length !== buyAmountsLamport.length) {
    throw new Error(
      `Bundle buy mismatch: wallets=${wallets.length}, amounts=${buyAmountsLamport.length}`
    );
  }
  if (wallets.length === 0) {
    const createOnlyTx = new Transaction();
    addBundleComputeBudget(createOnlyTx);
    createOnlyTx.add(...filterComputeBudget(createTx.instructions));
    if (!createOnlyTx.feePayer) {
      createOnlyTx.feePayer = createSigners[0]?.publicKey;
    }
    logger.info("Bundle create-only transaction built", {
      ...logContext,
      instructionCount: createOnlyTx.instructions.length,
      feePayer: createOnlyTx.feePayer?.toBase58(),
    });
    return [[createOnlyTx], [createSigners]];
  }

  const bundleTransactions: Transaction[] = [];
  const bundleSigners: Keypair[][] = [];
  const firstTransactionBuyCount = Math.min(1, wallets.length);
  // Capped at 2 buys per non-creator transaction because the new pump IDL's
  // buy_exact_sol_in uses 18 accounts per buy, which overflows the 1232-byte
  // versioned tx limit at 3 buys/tx without an address lookup table.
  // Combined with Jito's 5-tx bundle limit, this allows up to 9 buyer wallets
  // (1 creator + 4 follow-up txs × 2 buys). Revisit when launch ALT lands.
  const buysPerTransaction = 2;

  const firstWallets = wallets.slice(0, firstTransactionBuyCount);
  const firstAmounts = buyAmountsLamport.slice(0, firstTransactionBuyCount);
  const firstBuyTxResults = await Promise.allSettled(
    firstWallets.map((wallet, i) =>
      buildBuyTransaction(wallet, mint, firstAmounts[i], creator)
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

  const hoistedAtaInstructions: TransactionInstruction[] = [];
  const hoistedAtaSigners: Keypair[] = [];
  const deferredTransactions: Transaction[] = [];
  const deferredSignerGroups: Keypair[][] = [];

  const firstTxInstructionsWithoutHoists = [
    ...filterComputeBudget(createTx.instructions),
    ...firstBuyTxResults.flatMap((result) =>
      result.status === "fulfilled"
        ? filterComputeBudget(result.value.instructions)
        : []
    ),
  ];

  const canHoistAtaInstructions = (
    wallet: Keypair,
    ataCreateInstructions: TransactionInstruction[]
  ) => {
    if (ataCreateInstructions.length === 0) {
      return false;
    }

    const candidateTx = new Transaction();
    const nextHoistedAtaInstructions = [
      ...hoistedAtaInstructions,
      ...ataCreateInstructions,
    ];
    const includeComputeBudget = nextHoistedAtaInstructions.length === 0;
    if (includeComputeBudget) {
      addBundleComputeBudget(candidateTx);
    }
    if (firstTxInstructionsWithoutHoists.length > 0) {
      candidateTx.add(...firstTxInstructionsWithoutHoists);
    }
    if (nextHoistedAtaInstructions.length > 0) {
      candidateTx.add(...nextHoistedAtaInstructions);
    }
    candidateTx.feePayer = firstWallets[0]?.publicKey;

    try {
      const estimatedSize = estimateVersionedTransactionSize(candidateTx, [
        ...createSigners,
        ...firstWallets,
        ...hoistedAtaSigners,
        wallet,
      ]);
      return estimatedSize <= MAX_RAW_TRANSACTION_BYTES;
    } catch {
      return false;
    }
  };

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
      creator,
      {
        buildBuyTransaction,
        hoistedAtaInstructions,
        hoistedAtaSigners,
        shouldHoistAtaInstructions: canHoistAtaInstructions,
      }
    );
    deferredTransactions.push(tx);
    deferredSignerGroups.push(walletsSlice);
  }

  const firstTx = new Transaction();
  const includeFirstTxComputeBudget = hoistedAtaInstructions.length === 0;
  if (includeFirstTxComputeBudget) {
    addBundleComputeBudget(firstTx);
  }
  firstTx.add(...filterComputeBudget(createTx.instructions));
  if (hoistedAtaInstructions.length > 0) {
    firstTx.add(...hoistedAtaInstructions);
  }

  for (const result of firstBuyTxResults) {
    if (result.status === "fulfilled") {
      firstTx.add(...filterComputeBudget(result.value.instructions));
    }
  }

  firstTx.feePayer = firstWallets[0].publicKey;
  const firstFulfilledCount = firstBuyTxResults.filter(
    (result) => result.status === "fulfilled"
  ).length;
  logger.info("Bundle first transaction built", {
    ...logContext,
    buyCount: firstTransactionBuyCount,
    fulfilledBuys: firstFulfilledCount,
    hoistedAtaInstructionCount: hoistedAtaInstructions.length,
    computeBudgetIncluded: includeFirstTxComputeBudget,
    instructionCount: firstTx.instructions.length,
    feePayer: firstTx.feePayer?.toBase58(),
  });
  bundleTransactions.push(firstTx);
  bundleSigners.push([...createSigners, ...firstWallets, ...hoistedAtaSigners]);
  bundleTransactions.push(...deferredTransactions);
  bundleSigners.push(...deferredSignerGroups);

  return [bundleTransactions, bundleSigners];
}

async function buildBuyBundleTransaction(
  wallets: Keypair[],
  mint: PublicKey,
  buyAmountsLamport: bigint[],
  creator?: PublicKey,
  options?: {
    buildBuyTransaction?: BuildBuyTransaction;
    hoistedAtaInstructions?: TransactionInstruction[];
    hoistedAtaSigners?: Keypair[];
    shouldHoistAtaInstructions?: (
      wallet: Keypair,
      ataCreateInstructions: TransactionInstruction[]
    ) => boolean;
  }
): Promise<Transaction> {
  const logContext = {
    mint: mint.toBase58(),
    ...(creator ? { creator: creator.toBase58() } : {}),
  };
  const buildBuyTransaction =
    options?.buildBuyTransaction ?? buildBuyTokenTransaction;
  const hoistedAtaInstructions = options?.hoistedAtaInstructions;
  const hoistedAtaSigners = options?.hoistedAtaSigners;
  const shouldHoistAtaInstructions = options?.shouldHoistAtaInstructions;
  if (wallets.length !== buyAmountsLamport.length) {
    throw new Error(
      `Bundle buy mismatch: wallets=${wallets.length}, amounts=${buyAmountsLamport.length}`
    );
  }
  const buyTxResults = await Promise.allSettled(
    wallets.map((wallet, i) =>
      buildBuyTransaction(wallet, mint, buyAmountsLamport[i], creator)
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
  addBundleComputeBudget(outputTx);
  for (const [resultIndex, result] of buyTxResults.entries()) {
    if (result.status === "fulfilled") {
      const {
        ataCreateInstructions,
        remainingInstructions,
      } = splitAtaCreateInstructions(filterComputeBudget(result.value.instructions));
      const hoistAtaInstructions = Boolean(
        hoistedAtaInstructions &&
          shouldHoistAtaInstructions?.(wallets[resultIndex]!, ataCreateInstructions)
      );
      if (hoistAtaInstructions && hoistedAtaInstructions) {
        hoistedAtaInstructions.push(...ataCreateInstructions);
        if (ataCreateInstructions.length > 0 && hoistedAtaSigners) {
          hoistedAtaSigners.push(wallets[resultIndex]!);
        }
      } else if (ataCreateInstructions.length > 0) {
        outputTx.add(...ataCreateInstructions);
      }
      outputTx.add(...remainingInstructions);
    }
  }

  outputTx.feePayer = wallets[0].publicKey;
  const fulfilledCount = buyTxResults.filter(
    (result) => result.status === "fulfilled"
  ).length;
  logger.info("Bundle buy transaction built", {
    ...logContext,
    walletCount: wallets.length,
    fulfilledBuys: fulfilledCount,
    hoistedAtaInstructionCount: hoistedAtaInstructions?.length ?? 0,
    instructionCount: outputTx.instructions.length,
    feePayer: outputTx.feePayer?.toBase58(),
  });
  return outputTx;
}
