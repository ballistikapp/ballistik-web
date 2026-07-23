import {
  ComputeBudgetProgram,
  type AddressLookupTableAccount,
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

// Sized from measured usage (max ~193k CU for create+dev-buy, ~13k for buy
// txs) with generous margin. Lower requested CU improves Jito auction
// priority: bundles are ranked by tip / requested CU.
const BUNDLE_COMPUTE_UNITS = 400_000;
/** Solana raw transaction size limit; packing and AppTransaction mapping share this. */
export const MAX_RAW_TRANSACTION_BYTES = 1232;
/** Follow-up (non-create) buys per tx without an address lookup table. */
export const BUNDLE_BUYS_PER_FOLLOW_UP_TX_WITHOUT_ALT = 2;
/** Follow-up buys per tx when a launch ALT compresses shared accounts. */
export const BUNDLE_BUYS_PER_FOLLOW_UP_TX_WITH_ALT = 4;
const SIZE_ESTIMATE_BLOCKHASH = "11111111111111111111111111111111";

export function bundleBuysPerFollowUpTransaction(hasAlt: boolean): number {
  return hasAlt
    ? BUNDLE_BUYS_PER_FOLLOW_UP_TX_WITH_ALT
    : BUNDLE_BUYS_PER_FOLLOW_UP_TX_WITHOUT_ALT;
}

/**
 * Bundle layout: tx[0] = create + first buyer; later txs pack
 * `buysPerFollowUpTransaction` buyers each.
 */
export function bundleBuyerTransactionIndex(
  buyerIndex: number,
  buysPerFollowUpTransaction: number
): number {
  if (buyerIndex === 0) return 0;
  return 1 + Math.floor((buyerIndex - 1) / buysPerFollowUpTransaction);
}

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
  signers: Keypair[],
  altAccounts: AddressLookupTableAccount[] = []
) {
  if (!tx.feePayer) {
    throw new Error("Cannot estimate size for transaction without fee payer");
  }

  const message = new TransactionMessage({
    payerKey: tx.feePayer,
    recentBlockhash: SIZE_ESTIMATE_BLOCKHASH,
    instructions: tx.instructions,
  }).compileToV0Message(altAccounts);
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

export type BundleBuyBuildFailure = {
  walletPublicKey: string;
  errorMessage: string;
  batch: "first_tx" | "follow_up";
};

type BuildBuyTransactionResult = Awaited<ReturnType<BuildBuyTransaction>>;

function collectRejectedBuyBuilds(
  wallets: Keypair[],
  results: PromiseSettledResult<BuildBuyTransactionResult>[],
  batch: BundleBuyBuildFailure["batch"]
): BundleBuyBuildFailure[] {
  const failures: BundleBuyBuildFailure[] = [];
  for (let index = 0; index < results.length; index += 1) {
    const result = results[index];
    if (result?.status === "rejected") {
      failures.push({
        walletPublicKey: wallets[index]!.publicKey.toBase58(),
        errorMessage: formatError(result.reason),
        batch,
      });
    }
  }
  return failures;
}

function logBuyBuildFailures(
  logContext: Record<string, unknown>,
  failures: BundleBuyBuildFailure[],
  total: number
) {
  if (failures.length === 0) {
    return;
  }
  logger.warn("Bundle buy instruction build failed", {
    ...logContext,
    failedCount: failures.length,
    total,
    failures,
  });
}

export async function buildBundleTransactionsForCreateAndBuys(
  createTx: Transaction,
  createSigners: Keypair[],
  wallets: Keypair[],
  mint: PublicKey,
  buyAmountsLamport: bigint[],
  creator?: PublicKey,
  options?: {
    buildBuyTransaction?: BuildBuyTransaction;
    launchId?: string;
    altAccounts?: AddressLookupTableAccount[];
  }
): Promise<[Transaction[], Keypair[][], BundleBuyBuildFailure[]]> {
  const logContext = {
    mint: mint.toBase58(),
    ...(creator ? { creator: creator.toBase58() } : {}),
    ...(options?.launchId ? { launchId: options.launchId } : {}),
  };
  const buyBuildFailures: BundleBuyBuildFailure[] = [];
  const buildBuyTransaction =
    options?.buildBuyTransaction ?? buildBuyTokenTransaction;
  const altAccounts = options?.altAccounts ?? [];
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
    return [[createOnlyTx], [createSigners], buyBuildFailures];
  }

  const bundleTransactions: Transaction[] = [];
  const bundleSigners: Keypair[][] = [];
  const firstTransactionBuyCount = Math.min(1, wallets.length);
  // Capped without ALT because buy_exact_sol_in uses 18 accounts per buy and
  // overflows the 1232-byte versioned tx limit at 3 buys/tx. Combined with
  // Jito's 5-tx bundle limit, this allows up to 9 buyer wallets
  // (1 creator + 4 follow-up txs × 2 buys). With a launch ALT, more buys fit.
  // Serialized size is still validated below before committing to this grouping.
  const buysPerTransaction = bundleBuysPerFollowUpTransaction(
    altAccounts.length > 0
  );

  const firstWallets = wallets.slice(0, firstTransactionBuyCount);
  const firstAmounts = buyAmountsLamport.slice(0, firstTransactionBuyCount);
  const firstBuyTxResults = await Promise.allSettled(
    firstWallets.map((wallet, i) =>
      buildBuyTransaction(wallet, mint, firstAmounts[i], creator)
    )
  );
  const firstFailures = collectRejectedBuyBuilds(
    firstWallets,
    firstBuyTxResults,
    "first_tx"
  );
  buyBuildFailures.push(...firstFailures);
  logBuyBuildFailures(logContext, firstFailures, firstBuyTxResults.length);

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
      const estimatedSize = estimateVersionedTransactionSize(
        candidateTx,
        [...createSigners, ...firstWallets, ...hoistedAtaSigners, wallet],
        altAccounts
      );
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
    const { transaction: tx, failures: followUpFailures } =
      await buildBuyBundleTransaction(
        walletsSlice,
        mint,
        buyAmountsSlice,
        creator,
        {
          buildBuyTransaction,
          hoistedAtaInstructions,
          hoistedAtaSigners,
          shouldHoistAtaInstructions: canHoistAtaInstructions,
          logContext,
        }
      );
    if (!tx.feePayer) {
      tx.feePayer = walletsSlice[0]?.publicKey;
    }
    const estimatedSize = estimateVersionedTransactionSize(
      tx,
      walletsSlice,
      altAccounts
    );
    if (estimatedSize > MAX_RAW_TRANSACTION_BYTES) {
      throw new Error(
        `Bundle follow-up transaction exceeds ${MAX_RAW_TRANSACTION_BYTES} bytes ` +
          `(${estimatedSize} bytes, ${walletsSlice.length} buys/tx). Lower bundlerWalletCount.`
      );
    }
    buyBuildFailures.push(...followUpFailures);
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

  return [bundleTransactions, bundleSigners, buyBuildFailures];
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
    logContext?: Record<string, unknown>;
  }
): Promise<{ transaction: Transaction; failures: BundleBuyBuildFailure[] }> {
  const logContext = {
    mint: mint.toBase58(),
    ...(creator ? { creator: creator.toBase58() } : {}),
    ...options?.logContext,
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
  const failures = collectRejectedBuyBuilds(
    wallets,
    buyTxResults,
    "follow_up"
  );
  logBuyBuildFailures(logContext, failures, buyTxResults.length);

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
  return { transaction: outputTx, failures };
}
