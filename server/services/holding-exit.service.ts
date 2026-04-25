import "server-only";
import { prisma, Prisma } from "@/lib/prisma";
import { AppError } from "@/server/errors";
import { getSolanaConnection } from "@/lib/solana/connection";
import { refreshCacheService } from "@/server/services/refresh-cache.service";
import { mapWithConcurrency } from "@/lib/utils/async";
import { walletService } from "@/server/services/wallet.service";
import { persistHoldingExitLog } from "@/server/services/log-persistence.service";
import { testRunLogService } from "@/server/services/test-run-log.service";
import { buildSellTransaction } from "@/server/solana/pump-new-idl";
import { sendJitoBundle } from "@/server/solana/jito-bundle";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
  type Connection,
} from "@solana/web3.js";
import {
  createAssociatedTokenAccountInstruction,
  createCloseAccountInstruction,
  createTransferCheckedInstruction,
  getAccount,
  getAssociatedTokenAddress,
} from "@solana/spl-token";
import bs58 from "bs58";
import { logger } from "@/lib/logger";
import type {
  ActiveExitInput,
  CancelExitInput,
  ExitStatusInput,
  StartExitInput,
} from "@/server/schemas/holding.schema";
import { withActionLock, withIdempotency } from "@/server/security/api-abuse";
import { grpcAccessService } from "@/server/services/grpc-access.service";
import { appTransactionService } from "@/server/services/app-transaction.service";
import type { ContextUser } from "@/server/schemas/auth.schema";
import { UserPlan } from "@/lib/generated/prisma/client";
import { invalidateStatsCache } from "@/server/services/dashboard.service";
import { getEnv } from "@/lib/config/env";
import { bundledExitFeeSol } from "@/lib/config/usage-fees.config";
import {
  recoverWalletSolBalances,
  resolveReturnSolToMainWallet,
  sweepSystemDevRealizedSol,
} from "@/server/services/holding-sol-recovery";
import { deriveHoldingExitTerminalStatus } from "@/server/services/holding-exit-status";
import { usageFeeService } from "@/server/services/usage-fee.service";

const cancelledExits = new Set<string>();

export function isExitCancelled(exitId: string) {
  return cancelledExits.has(exitId);
}

function markExitCancelled(exitId: string) {
  cancelledExits.add(exitId);
  setTimeout(() => cancelledExits.delete(exitId), 5 * 60 * 1000);
}

type WalletRecord = {
  publicKey: string;
  privateKey: string;
  isSystemWallet?: boolean;
};

type WalletBalance = {
  wallet: WalletRecord;
  balance: bigint;
};

type ExitSummary = {
  totalWallets: number;
  totalChunks: number;
  successfulChunks: number;
  failedChunks: number;
  totalTokensRaw: string;
  totalTokensUi: number;
  tokenDecimals: number;
  bundlesProcessed: number;
  walletsFunded: number;
  fundingLamports: number;
  atasClosed: number;
  solRecoveredLamports: number;
  solRecoveredSol: number;
  cleanupFailedWallets: number;
  requestedReturnSolToMainWallet: boolean;
  effectiveReturnSolToMainWallet: boolean;
  systemDevImmediateSweeps: number;
  systemDevImmediateSweepFailures: number;
  systemDevImmediateSweepLamports: number;
  totalJitoTipLamports: number;
  totalJitoTipSol: number;
  exitFeeSol: number;
  exitFeeCollected: boolean;
  exitFeeSignature: string | null;
  exitFeeError: string | null;
};

const DEFAULT_JITO_TIP_SOL = 0.005;
const MAX_BUNDLE_TXS = 5;
const TRANSFERS_PER_GROUP = 5;
const WALLETS_PER_CHUNK = 20;
const CLEANUP_WALLET_CONCURRENCY = 3;
const MIN_RENT_LAMPORTS = 2_100_000;
const FUND_AMOUNT_LAMPORTS = 5_000_000;
const EXIT_LOG_WINDOW = 200;
type RequestUser = Pick<ContextUser, "id" | "plan">;
type StoredHoldingExitInput = StartExitInput & {
  entitlementSnapshot?: {
    plan: ContextUser["plan"];
  };
};

async function appendExitLog(
  exitId: string,
  level: "INFO" | "WARN" | "ERROR" | "STEP",
  message: string,
  step?: string,
  data?: Record<string, unknown>
) {
  await persistHoldingExitLog({
    exitId,
    level,
    message,
    step: step ?? null,
    data: data ? (data as Prisma.InputJsonValue) : Prisma.JsonNull,
  });
}

async function updateExit(
  exitId: string,
  data: Partial<{
    status:
      | "PENDING"
      | "RUNNING"
      | "FAILED"
      | "PARTIAL_SUCCESS"
      | "SUCCEEDED";
    progress: number;
    currentStep: string | null;
    result: ExitSummary | null;
    errorMessage: string | null;
    startedAt: Date | null;
    completedAt: Date | null;
  }>
) {
  // Transform result field for Prisma's JSON type handling
  const prismaData = {
    ...data,
    result:
      data.result === undefined
        ? undefined
        : data.result === null
          ? Prisma.JsonNull
          : (data.result as Prisma.InputJsonValue),
  };

  await prisma.holdingExit.update({
    where: { id: exitId },
    data: prismaData,
  });
}

async function getAllowedWalletsWithKeys(
  tokenPublicKey: string,
  userId: string
) {
  const token = await prisma.token.findFirst({
    where: { publicKey: tokenPublicKey, userId },
    select: { publicKey: true, name: true, symbol: true },
  });

  if (!token) {
    throw new AppError("Token not found", 404);
  }

  const [operationalWallets, devWallet, user] = await Promise.all([
    prisma.wallet.findMany({
      where: {
        tokenPublicKey,
        type: { in: ["BUNDLER", "VOLUME", "DISTRIBUTION"] },
      },
      select: { publicKey: true, privateKey: true, isSystemWallet: true },
    }),
    prisma.tokenDevWallet.findFirst({
      where: { tokenPublicKey },
      select: { wallet: { select: { publicKey: true, privateKey: true, isSystemWallet: true } } },
    }),
    prisma.user.findUnique({
      where: { id: userId },
      select: {
        mainWallet: { select: { publicKey: true, privateKey: true, isSystemWallet: true } },
      },
    }),
  ]);

  const mainWallet = user?.mainWallet;
  if (!mainWallet) {
    throw new AppError("Main wallet not found", 400);
  }

  const resolvedDevWallet = devWallet?.wallet
    ? devWallet.wallet.isSystemWallet
      ? { ...devWallet.wallet, privateKey: getEnv().SYSTEM_DEV_WALLET_PRIVATE_KEY, isSystemWallet: true as const }
      : devWallet.wallet
    : null;

  const allWallets: WalletRecord[] = [
    mainWallet,
    ...(resolvedDevWallet ? [resolvedDevWallet] : []),
    ...operationalWallets,
  ].filter((wallet) => Boolean(wallet.privateKey));

  const walletMap = new Map<string, WalletRecord>();
  allWallets.forEach((wallet) => {
    walletMap.set(wallet.publicKey, wallet);
  });

  return { token, wallets: Array.from(walletMap.values()), mainWallet };
}

async function getMintDecimals(mint: PublicKey) {
  const connection = getSolanaConnection();
  const mintInfo = await connection.getParsedAccountInfo(mint);
  return (
    (mintInfo.value?.data as { parsed?: { info?: { decimals?: number } } })
      ?.parsed?.info?.decimals ?? 9
  );
}

async function getTokenBalancesForWallets(
  wallets: WalletRecord[],
  mint: PublicKey
) {
  const connection = getSolanaConnection();

  const atas = await Promise.all(
    wallets.map(async (wallet) => ({
      wallet,
      ata: await getAssociatedTokenAddress(mint, new PublicKey(wallet.publicKey)),
    }))
  );

  type AccountInfoItem = Awaited<
    ReturnType<Connection["getMultipleAccountsInfo"]>
  >[number];
  const ataAddresses = atas.map((a) => a.ata);
  const accountInfos: AccountInfoItem[] = [];
  for (let i = 0; i < ataAddresses.length; i += 100) {
    const batch = ataAddresses.slice(i, i + 100);
    const batchInfos = await connection.getMultipleAccountsInfo(batch);
    accountInfos.push(...batchInfos);
  }

  return atas.map(({ wallet }, index) => {
    const accountInfo = accountInfos[index];
    let balance = BigInt(0);
    if (accountInfo?.data) {
      try {
        const dataView = new DataView(
          accountInfo.data.buffer,
          accountInfo.data.byteOffset,
          accountInfo.data.byteLength
        );
        balance = dataView.getBigUint64(64, true);
      } catch {
        balance = BigInt(0);
      }
    }
    return { wallet, balance };
  });
}

function chunkWallets<T>(items: T[], chunkSize: number) {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += chunkSize) {
    chunks.push(items.slice(i, i + chunkSize));
  }
  return chunks;
}

function formatTokens(amount: bigint, decimals: number) {
  const divisor = BigInt(10 ** decimals);
  const whole = amount / divisor;
  const fraction = amount % divisor;
  const fractionStr = fraction.toString().padStart(decimals, "0");
  return Number(`${whole}.${fractionStr}`.replace(/\.?0+$/, ""));
}

async function fundUnderfundedWallets({
  wallets,
  mainWallet,
  exitId,
  userId,
  tokenPublicKey,
}: {
  wallets: WalletRecord[];
  mainWallet: Keypair;
  exitId: string;
  userId?: string;
  tokenPublicKey?: string;
}) {
  const connection = getSolanaConnection();
  const walletsToFund: { publicKey: PublicKey; needed: number }[] = [];

  const balances = await mapWithConcurrency(wallets, 5, async (wallet) => {
    if (wallet.publicKey === mainWallet.publicKey.toBase58()) {
      return { wallet, balance: Infinity };
    }
    const balance = await connection.getBalance(new PublicKey(wallet.publicKey));
    return { wallet, balance };
  });

  for (const { wallet, balance } of balances) {
    if (balance < MIN_RENT_LAMPORTS) {
      walletsToFund.push({
        publicKey: new PublicKey(wallet.publicKey),
        needed: FUND_AMOUNT_LAMPORTS - balance,
      });
    }
  }

  if (walletsToFund.length === 0) {
    return { funded: 0, totalLamports: 0 };
  }

  await appendExitLog(exitId, "INFO", `Funding ${walletsToFund.length} underfunded wallets`, "funding", {
    count: walletsToFund.length,
  });

  const latestBlockhash = await connection.getLatestBlockhash("confirmed");
  let funded = 0;
  let totalLamports = 0;

  const fundingBatches = chunkWallets(walletsToFund, 10);

  for (const batch of fundingBatches) {
    const tx = new Transaction();
    let batchTotal = 0;

    for (const { publicKey, needed } of batch) {
      tx.add(
        SystemProgram.transfer({
          fromPubkey: mainWallet.publicKey,
          toPubkey: publicKey,
          lamports: needed,
        })
      );
      batchTotal += needed;
    }

    tx.recentBlockhash = latestBlockhash.blockhash;
    tx.feePayer = mainWallet.publicKey;

    try {
      const batchTrackIds: string[] = [];
      if (userId) {
        for (const item of batch) {
          const id = await appTransactionService
            .create({
              userId,
              type: "TRANSFER_FUND",
              source: "EXIT",
              tokenPublicKey,
              walletPublicKey: mainWallet.publicKey.toBase58(),
              fromAddress: mainWallet.publicKey.toBase58(),
              toAddress: item.publicKey.toBase58(),
              solAmount: item.needed / 1_000_000_000,
              referenceId: exitId,
            })
            .then((r) => r.id)
            .catch(() => null);
          if (id) batchTrackIds.push(id);
        }
      }
      const signature = await sendAndConfirmTransaction(connection, tx, [mainWallet], {
        commitment: "confirmed",
      });
      if (batchTrackIds.length > 0) await appTransactionService.confirmMany(batchTrackIds, { signature }).catch(() => {});
      await testRunLogService.appendServerEvent({
        eventType: "wallet_transaction",
        source: "holding-exit.service",
        action: "holding-exit.fundWalletBatch",
        wallets: [mainWallet.publicKey.toBase58(), ...batch.map((item) => item.publicKey.toBase58())],
        signature,
        status: "submitted",
        actualValue: {
          batchSize: batch.length,
          batchTotalLamports: batchTotal,
        },
      });
      funded += batch.length;
      totalLamports += batchTotal;
    } catch (error) {
      logger.warn("Failed to fund wallets batch", {
        error: error instanceof Error ? error.message : String(error),
        batchSize: batch.length,
      });
    }
  }

  await appendExitLog(exitId, "INFO", `Funded ${funded} wallets`, "funding", {
    funded,
    totalSol: totalLamports / 1_000_000_000,
  });

  return { funded, totalLamports };
}

async function buildExitBundleTransactions({
  chunk,
  mint,
  decimals,
  mainWallet,
  seller,
  totalAmount,
}: {
  chunk: WalletBalance[];
  mint: PublicKey;
  decimals: number;
  mainWallet: Keypair;
  seller: WalletRecord;
  totalAmount: bigint;
}) {
  const sellerKeypair = Keypair.fromSecretKey(bs58.decode(seller.privateKey));
  const sellerPublicKey = sellerKeypair.publicKey;
  const sellerAta = await getAssociatedTokenAddress(mint, sellerPublicKey);
  const connection = getSolanaConnection();

  let sellerAtaExists = true;
  try {
    await getAccount(connection, sellerAta);
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message.includes("Account does not exist") ||
        error.message.includes("could not find account") ||
        error.name === "TokenAccountNotFoundError")
    ) {
      sellerAtaExists = false;
    } else {
      throw error;
    }
  }

  const senders = chunk.slice(1);
  const senderGroups = chunkWallets(senders, TRANSFERS_PER_GROUP);
  const transactions: Transaction[] = [];
  const signerGroups: Keypair[][] = [];

  const ensureSellerAta = !sellerAtaExists;

  // Process transfer groups (no sell instruction in these)
  for (let groupIndex = 0; groupIndex < senderGroups.length; groupIndex += 1) {
    const group = senderGroups[groupIndex];
    const tx = new Transaction();

    if (ensureSellerAta && groupIndex === 0) {
      tx.add(
        createAssociatedTokenAccountInstruction(
          mainWallet.publicKey,
          sellerAta,
          sellerPublicKey,
          mint
        )
      );
    }

    const transferSigners: Keypair[] = [];
    for (const entry of group) {
      const senderKeypair = Keypair.fromSecretKey(
        bs58.decode(entry.wallet.privateKey)
      );
      const senderAta = await getAssociatedTokenAddress(
        mint,
        senderKeypair.publicKey
      );
      tx.add(
        createTransferCheckedInstruction(
          senderAta,
          mint,
          sellerAta,
          senderKeypair.publicKey,
          entry.balance,
          decimals
        )
      );
      transferSigners.push(senderKeypair);
    }

    tx.feePayer = mainWallet.publicKey;
    transactions.push(tx);
    signerGroups.push([mainWallet, ...transferSigners]);
  }

  const sellTx = await buildSellTransaction(
    sellerKeypair,
    mint,
    BigInt(totalAmount.toString())
  );

  const tx = new Transaction();
  if (senderGroups.length === 0 && ensureSellerAta) {
    tx.add(
      createAssociatedTokenAccountInstruction(
        mainWallet.publicKey,
        sellerAta,
        sellerPublicKey,
        mint
      )
    );
  }
  sellTx.instructions.forEach((instruction) => {
    tx.add(instruction);
  });
  tx.feePayer = mainWallet.publicKey;
  transactions.push(tx);
  signerGroups.push([mainWallet, sellerKeypair]);

  if (transactions.length > MAX_BUNDLE_TXS) {
    throw new AppError("Exit bundle exceeds max transaction count", 400);
  }

  return { transactions, signerGroups };
}

async function closeAtasAndRecoverSol({
  wallets,
  mint,
  mainWallet,
  returnSolToMainWallet,
  exitId,
  isCancelled,
  userId,
  tokenPublicKey,
}: {
  wallets: WalletRecord[];
  mint: PublicKey;
  mainWallet: Keypair;
  returnSolToMainWallet: boolean;
  exitId: string;
  isCancelled: () => boolean;
  userId?: string;
  tokenPublicKey?: string;
}) {
  const connection = getSolanaConnection();
  const cleanupWallets = wallets.filter(
    (wallet) => wallet.publicKey !== mainWallet.publicKey.toBase58()
  );

  await appendExitLog(exitId, "INFO", "Cleanup started", "cleanup", {
    wallets: cleanupWallets.length,
    concurrency: CLEANUP_WALLET_CONCURRENCY,
    returnSolToMainWallet,
  });

  const results = await mapWithConcurrency(
    cleanupWallets,
    CLEANUP_WALLET_CONCURRENCY,
    async (wallet) => {
      if (isCancelled()) {
        throw new Error("Exit cancelled by user");
      }

      const owner = Keypair.fromSecretKey(bs58.decode(wallet.privateKey));
      const ata = await getAssociatedTokenAddress(mint, owner.publicKey);
      let ataClosed = false;
      const solRecoveredLamports = 0;
      const errors: string[] = [];

      try {
        let accountBalance = BigInt(0);
        let ataExists = true;
        try {
          const account = await getAccount(connection, ata);
          accountBalance = account.amount;
        } catch (error) {
          if (
            error instanceof Error &&
            (error.message.includes("Account does not exist") ||
              error.message.includes("could not find account") ||
              error.name === "TokenAccountNotFoundError")
          ) {
            accountBalance = BigInt(0);
            ataExists = false;
          } else {
            throw error;
          }
        }

        if (ataExists && accountBalance === BigInt(0)) {
          if (isCancelled()) {
            throw new Error("Exit cancelled by user");
          }
          try {
            const closeTx = new Transaction().add(
              createCloseAccountInstruction(
                ata,
                mainWallet.publicKey,
                owner.publicKey
              )
            );
            const latestBlockhash = await connection.getLatestBlockhash(
              "confirmed"
            );
            closeTx.recentBlockhash = latestBlockhash.blockhash;
            closeTx.feePayer = mainWallet.publicKey;
            const ataCloseTrackId = userId
              ? await appTransactionService.create({
                  userId,
                  type: "ACCOUNT_ATA_CLOSE",
                  source: "EXIT",
                  tokenPublicKey,
                  walletPublicKey: wallet.publicKey,
                  fromAddress: wallet.publicKey,
                  referenceId: exitId,
                }).then((r) => r.id).catch(() => null)
              : null;
            const signature = await sendAndConfirmTransaction(connection, closeTx, [
              mainWallet,
              owner,
            ]);
            if (ataCloseTrackId) await appTransactionService.confirm(ataCloseTrackId, { signature }).catch(() => {});
            await testRunLogService.appendServerEvent({
              eventType: "wallet_transaction",
              source: "holding-exit.service",
              action: "holding-exit.closeAta",
              wallets: [wallet.publicKey],
              signature,
              status: "submitted",
            });
            ataClosed = true;
          } catch (error) {
            const message =
              error instanceof Error ? error.message : String(error);
            errors.push(`closeAta: ${message}`);
            logger.warn("Failed to close ATA", {
              wallet: wallet.publicKey,
              error: message,
            });
          }
        }

      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        errors.push(`walletCleanup: ${message}`);
      }

      return {
        walletPublicKey: wallet.publicKey,
        status: errors.length > 0 ? ("FAILED" as const) : ("OK" as const),
        ataClosed,
        solRecoveredLamports,
        errors,
      };
    }
  );

  const atasClosed = results.filter((result) => result.ataClosed).length;
  const ataCloseFailedWallets = results.filter(
    (result) => result.status === "FAILED"
  );
  const solRecovery = returnSolToMainWallet
    ? await recoverWalletSolBalances({
        connection,
        wallets: cleanupWallets,
        mainWalletKeypair: mainWallet,
        source: "EXIT",
        logSource: "holding-exit.service",
        logAction: "holding-exit.recoverSol",
        preserveRentExemptMinimum: false,
        userId,
        tokenPublicKey,
        referenceId: exitId,
        concurrency: CLEANUP_WALLET_CONCURRENCY,
      })
    : null;
  const solRecoveredLamports = solRecovery?.totalLamports ?? 0;
  const cleanupFailureWallets = new Set<string>([
    ...ataCloseFailedWallets.map((result) => result.walletPublicKey),
    ...(solRecovery?.results ?? [])
      .filter((result) => result.status === "FAILED")
      .map((result) => result.walletPublicKey),
  ]);

  await appendExitLog(
    exitId,
    cleanupFailureWallets.size > 0 ? "WARN" : "INFO",
    "Cleanup completed",
    "cleanup",
    {
      wallets: cleanupWallets.length,
      atasClosed,
      solRecoveredLamports,
      failedWallets: cleanupFailureWallets.size,
    }
  );

  return {
    atasClosed,
    solRecoveredLamports,
    cleanupFailedWallets: cleanupFailureWallets.size,
    ataCloseFailedWallets: ataCloseFailedWallets.length,
    solRecoveryFailedWallets: solRecovery?.failed ?? 0,
    solRecovery,
  };
}

async function runExitFlow(exitId: string) {
  const exit = await prisma.holdingExit.findUnique({
    where: { id: exitId },
  });
  if (!exit) {
    return;
  }

  const checkCancelled = () => {
    if (isExitCancelled(exitId)) {
      throw new Error("Exit cancelled by user");
    }
  };

  await updateExit(exitId, {
    status: "RUNNING",
    startedAt: new Date(),
    progress: 0,
    currentStep: "Preparing",
  });
  await appendExitLog(exitId, "STEP", "Exit started", "prepare");

  try {
    checkCancelled();
    const input = exit.input as StoredHoldingExitInput;
    const requestPlan = input.entitlementSnapshot?.plan ?? UserPlan.FREE;

    const { token, wallets, mainWallet } = await getAllowedWalletsWithKeys(
      exit.tokenPublicKey,
      exit.userId
    );
    const mint = new PublicKey(token.publicKey);
    const decimals = await getMintDecimals(mint);
    const mainKeypair = Keypair.fromSecretKey(
      bs58.decode(mainWallet.privateKey)
    );

    checkCancelled();

    const balances = await getTokenBalancesForWallets(wallets, mint);
    const nonZeroBalances = balances
      .filter((entry) => entry.balance > BigInt(0))
      .sort((a, b) => (a.balance > b.balance ? -1 : 1));

    if (nonZeroBalances.length === 0) {
      await appendExitLog(exitId, "WARN", "No token balances found", "prepare");
      await updateExit(exitId, {
        status: "FAILED",
        errorMessage: "No token balances found",
        completedAt: new Date(),
      });
      invalidateStatsCache(exit.tokenPublicKey);
      return;
    }

    // With max 5 txs per bundle and 1 tx reserved for sell:
    // 4 transfer txs * 5 transfers each = 20 wallets per chunk (1 seller + 19 senders).
    const chunks = chunkWallets(nonZeroBalances, WALLETS_PER_CHUNK);
    const totalTokens = nonZeroBalances.reduce(
      (total, entry) => total + entry.balance,
      BigInt(0)
    );
    const jitoTipSol =
      typeof exit.input === "object" && exit.input
        ? Number((exit.input as { jitoTipSol?: number }).jitoTipSol ?? DEFAULT_JITO_TIP_SOL)
        : DEFAULT_JITO_TIP_SOL;
    const requestedReturnSolToMainWallet =
      typeof exit.input === "object" && exit.input
        ? Boolean(
            (exit.input as { returnSolToMainWallet?: boolean })
              .returnSolToMainWallet
          )
        : false;
    const effectiveReturnSolToMainWallet = resolveReturnSolToMainWallet(
      nonZeroBalances.map((entry) => entry.wallet),
      requestedReturnSolToMainWallet
    );
    const tipLamports = Math.max(0, Math.floor(jitoTipSol * 1_000_000_000));

    await appendExitLog(exitId, "INFO", "Exit chunks prepared", "chunking", {
      chunkCount: chunks.length,
      totalWallets: nonZeroBalances.length,
      requestedReturnSolToMainWallet,
      effectiveReturnSolToMainWallet,
    });

    checkCancelled();

    await updateExit(exitId, {
      progress: 10,
      currentStep: "Funding underfunded wallets",
    });

    const walletsToCheck = nonZeroBalances.map((entry) => entry.wallet);
    const { funded: walletsFunded, totalLamports: fundingLamports } =
      await fundUnderfundedWallets({
        wallets: walletsToCheck,
        mainWallet: mainKeypair,
        exitId,
        userId: exit.userId,
        tokenPublicKey: exit.tokenPublicKey,
      });

    checkCancelled();

    let completedChunks = 0;
    const chunkResults = await mapWithConcurrency(
      chunks.map((chunk, index) => ({ chunk, index })),
      2,
      async ({ chunk, index }) => {
        checkCancelled();

        const seller = chunk[0]?.wallet;
        if (!seller) {
          return {
            chunkIndex: index + 1,
            status: "FAILED" as const,
            error: "No seller wallet in chunk",
          };
        }

        const chunkTotal = chunk.reduce(
          (total, entry) => total + entry.balance,
          BigInt(0)
        );

        await appendExitLog(
          exitId,
          "STEP",
          `Chunk ${index + 1}/${chunks.length} submit started`,
          "bundle",
          { seller: seller.publicKey }
        );

        try {
          checkCancelled();
          const { transactions, signerGroups } = await buildExitBundleTransactions({
            chunk,
            mint,
            decimals,
            mainWallet: mainKeypair,
            seller,
            totalAmount: chunkTotal,
          });

          checkCancelled();
          const bundleSellTrackId = await appTransactionService
            .create({
              userId: exit.userId,
              type: "TRADE_SELL",
              source: "EXIT",
              tokenPublicKey: exit.tokenPublicKey,
              walletPublicKey: seller.publicKey,
              fromAddress: seller.publicKey,
              tokenAmount: Number(chunkTotal),
              referenceId: exitId,
            })
            .then((r) => r.id)
            .catch(() => null);
          const bundleResult = await sendJitoBundle(
            transactions,
            signerGroups,
            mainKeypair,
            tipLamports,
            {
              enableGrpc: grpcAccessService.getFeatureAccess(
                { plan: requestPlan },
                "bundle-fast-confirmation"
              ).allowed,
            }
          );
          const sellSignature = bundleResult.signatures.at(-1) ?? null;
          if (bundleSellTrackId && sellSignature) {
            await appTransactionService
              .confirm(bundleSellTrackId, { signature: sellSignature })
              .catch(() => {});
          }
          const systemDevSweep = {
            attempted: false,
            failed: false,
            sweptLamports: 0,
          };
          if (seller.isSystemWallet && sellSignature) {
            systemDevSweep.attempted = true;
            try {
              const sweepResult = await sweepSystemDevRealizedSol({
                connection: getSolanaConnection(),
                sellSignature,
                systemDevKeypair: Keypair.fromSecretKey(
                  bs58.decode(seller.privateKey)
                ),
                mainWalletKeypair: mainKeypair,
                source: "EXIT",
                logSource: "holding-exit.service",
                logAction: "holding-exit.sweepSystemDevRealizedSol",
                userId: exit.userId,
                tokenPublicKey: exit.tokenPublicKey,
                referenceId: exitId,
              });
              if (sweepResult.status === "SWEEPED") {
                systemDevSweep.sweptLamports = sweepResult.sweptLamports;
              }
            } catch (error) {
              systemDevSweep.failed = true;
              await appendExitLog(
                exitId,
                "WARN",
                `Chunk ${index + 1}/${chunks.length} system dev sweep failed`,
                "cleanup",
                {
                  seller: seller.publicKey,
                  message:
                    error instanceof Error ? error.message : String(error),
                }
              );
            }
          }
          await testRunLogService.appendServerEvent({
            eventType: "wallet_transaction",
            source: "holding-exit.service",
            action: "holding-exit.sendBundle",
            wallets: chunk.map((entry) => entry.wallet.publicKey),
            status: "submitted",
            actualValue: {
              seller: seller.publicKey,
              bundleId: bundleResult.bundleId,
              signatures: bundleResult.signatures,
            },
          });
          await appendExitLog(
            exitId,
            "INFO",
            `Chunk ${index + 1}/${chunks.length} bundle submitted`,
            "bundle",
            {
              seller: seller.publicKey,
              bundleId: bundleResult.bundleId,
              signatures: bundleResult.signatures,
            }
          );
          return {
            chunkIndex: index + 1,
            status: "SUCCEEDED" as const,
            sellerPublicKey: seller.publicKey,
            bundleId: bundleResult.bundleId,
            signatures: bundleResult.signatures,
            systemDevSweep,
          };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (message === "Exit cancelled by user") {
            throw error;
          }
          await appendExitLog(
            exitId,
            "ERROR",
            `Chunk ${index + 1}/${chunks.length} failed`,
            "bundle",
            { seller: seller.publicKey, message }
          );
          return {
            chunkIndex: index + 1,
            status: "FAILED" as const,
            sellerPublicKey: seller.publicKey,
            error: message,
          };
        } finally {
          completedChunks += 1;
          const progress = Math.min(
            90,
            15 + Math.floor((completedChunks / chunks.length) * 75)
          );
          await updateExit(exitId, {
            progress,
            currentStep: `Processed ${completedChunks}/${chunks.length} chunks`,
          });
        }
      }
    );

    checkCancelled();
    const successfulChunks = chunkResults.filter(
      (result) => result.status === "SUCCEEDED"
    );
    const failedChunks = chunkResults.filter(
      (result) => result.status === "FAILED"
    );
    const bundlesProcessed = successfulChunks.length;
    const systemDevImmediateSweeps = successfulChunks.filter(
      (result) => result.systemDevSweep?.attempted
    ).length;
    const systemDevImmediateSweepFailures = successfulChunks.filter(
      (result) => result.systemDevSweep?.failed
    ).length;
    const systemDevImmediateSweepLamports = successfulChunks.reduce(
      (sum, result) => sum + (result.systemDevSweep?.sweptLamports ?? 0),
      0
    );

    if (failedChunks.length > 0) {
      await appendExitLog(
        exitId,
        "WARN",
        `${failedChunks.length} chunk(s) failed`,
        "bundle",
        {
          failedChunkIndexes: failedChunks.map((result) => result.chunkIndex),
        }
      );
    }

    await updateExit(exitId, {
      progress: 92,
      currentStep: "Closing ATAs",
    });
    await appendExitLog(exitId, "STEP", "Closing ATAs", "cleanup");

    const {
      atasClosed,
      solRecoveredLamports,
      cleanupFailedWallets,
    } =
      await closeAtasAndRecoverSol({
      wallets: nonZeroBalances.map((entry) => entry.wallet),
      mint,
      mainWallet: mainKeypair,
      returnSolToMainWallet: effectiveReturnSolToMainWallet,
      exitId,
      isCancelled: () => isExitCancelled(exitId),
      userId: exit.userId,
      tokenPublicKey: exit.tokenPublicKey,
    });

    const refreshWalletPublicKeys = Array.from(
      new Set([
        mainKeypair.publicKey.toBase58(),
        ...nonZeroBalances.map((entry) => entry.wallet.publicKey),
      ])
    );
    if (refreshWalletPublicKeys.length > 0) {
      try {
        await walletService.refreshWalletBalances(
          exit.tokenPublicKey,
          exit.userId,
          refreshWalletPublicKeys,
          true
        );
      } catch {}
    }

    await updateExit(exitId, {
      progress: 98,
      currentStep: effectiveReturnSolToMainWallet ? "Recovering SOL" : "Finalize",
    });
    await appendExitLog(
      exitId,
      "STEP",
      effectiveReturnSolToMainWallet
        ? "Recovering SOL"
        : "Skipping SOL recovery",
      "cleanup",
      { solRecoveredLamports }
    );

    const finalOutcome = deriveHoldingExitTerminalStatus({
      failedChunks: failedChunks.length,
      cleanupFailedWallets,
    });
    const exitFee = {
      collected: false,
      signature: null as string | null,
      error: null as string | null,
    };

    if (failedChunks.length === 0) {
      try {
        const feeResult = await usageFeeService.collectFromMainWallet({
          userId: exit.userId,
          totalFeeSol: bundledExitFeeSol,
          reason: "exit.bundled_sell",
          txSource: "EXIT",
          tokenPublicKey: exit.tokenPublicKey,
          referenceId: exitId,
        });
        exitFee.collected = !feeResult.skipped;
        exitFee.signature = feeResult.signature;
        if (!feeResult.skipped) {
          await walletService.refreshWalletBalances(
            exit.tokenPublicKey,
            exit.userId,
            [feeResult.fromPublicKey],
            true
          );
        }
        await appendExitLog(
          exitId,
          "INFO",
          feeResult.skipped
            ? "Bundled exit fee skipped"
            : "Bundled exit fee collected",
          "fee",
          {
            amountSol: bundledExitFeeSol,
            signature: feeResult.signature,
            fromPublicKey: feeResult.fromPublicKey,
            toPublicKey: feeResult.toPublicKey,
            skipped: feeResult.skipped,
          }
        );
      } catch (error) {
        exitFee.error = error instanceof Error ? error.message : String(error);
        await appendExitLog(
          exitId,
          "WARN",
          "Bundled exit fee collection failed",
          "fee",
          {
            amountSol: bundledExitFeeSol,
            message: exitFee.error,
          }
        );
      }
    }

    const summary: ExitSummary = {
      totalWallets: nonZeroBalances.length,
      totalChunks: chunks.length,
      successfulChunks: successfulChunks.length,
      failedChunks: failedChunks.length,
      totalTokensRaw: totalTokens.toString(),
      totalTokensUi: formatTokens(totalTokens, decimals),
      tokenDecimals: decimals,
      bundlesProcessed,
      walletsFunded,
      fundingLamports,
      atasClosed,
      solRecoveredLamports,
      solRecoveredSol: solRecoveredLamports / 1_000_000_000,
      cleanupFailedWallets,
      requestedReturnSolToMainWallet,
      effectiveReturnSolToMainWallet,
      systemDevImmediateSweeps,
      systemDevImmediateSweepFailures,
      systemDevImmediateSweepLamports,
      totalJitoTipLamports: bundlesProcessed * tipLamports,
      totalJitoTipSol: (bundlesProcessed * tipLamports) / 1_000_000_000,
      exitFeeSol: bundledExitFeeSol,
      exitFeeCollected: exitFee.collected,
      exitFeeSignature: exitFee.signature,
      exitFeeError: exitFee.error,
    };

    await updateExit(exitId, {
      status: finalOutcome.status,
      progress: 100,
      currentStep: "Complete",
      completedAt: new Date(),
      result: summary,
      errorMessage: finalOutcome.errorMessage,
    });
    await appendExitLog(
      exitId,
      finalOutcome.status === "SUCCEEDED" ? "INFO" : "WARN",
      finalOutcome.status === "FAILED"
        ? "Exit completed with failures"
        : finalOutcome.status === "PARTIAL_SUCCESS"
          ? "Exit completed with cleanup failures"
          : "Exit completed",
      "complete",
      summary
    );

    await refreshCacheService.touch({
      userId: exit.userId,
      tokenPublicKey: exit.tokenPublicKey,
      scope: "HOLDINGS",
    });
    invalidateStatsCache(exit.tokenPublicKey);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await appendExitLog(exitId, "ERROR", "Exit failed", "error", {
      message,
    });
    await updateExit(exitId, {
      status: "FAILED",
      errorMessage: message,
      completedAt: new Date(),
    });
    invalidateStatsCache(exit.tokenPublicKey);
  }
}

export const holdingExitService = {
  async startExit(input: StartExitInput, user: RequestUser) {
    const actionKey = `holding-exit:start:${user.id}:${input.tokenPublicKey}`;
    const idempotencyKey = `holding-exit:${user.id}:${input.tokenPublicKey}`;

    return await withActionLock(actionKey, async () => {
      return await withIdempotency({
        key: idempotencyKey,
        ttlMs: 15_000,
        execute: async () => {
          const existing = await prisma.holdingExit.findFirst({
            where: {
              userId: user.id,
              tokenPublicKey: input.tokenPublicKey,
              status: { in: ["PENDING", "RUNNING"] },
            },
            orderBy: { createdAt: "desc" },
          });

          if (existing) {
            return { exitId: existing.id };
          }

          const exit = await prisma.holdingExit.create({
            data: {
              userId: user.id,
              tokenPublicKey: input.tokenPublicKey,
              status: "PENDING",
              progress: 0,
              currentStep: "Queued",
              input: {
                ...input,
                entitlementSnapshot: {
                  plan: user.plan,
                },
              } satisfies StoredHoldingExitInput,
            },
          });

          await appendExitLog(exit.id, "STEP", "Exit queued", "queue");
          void runExitFlow(exit.id);

          return { exitId: exit.id };
        },
      });
    });
  },

  async getExitStatus(input: ExitStatusInput, userId: string) {
    const exit = await prisma.holdingExit.findFirst({
      where: { id: input.exitId, userId },
    });
    if (!exit) {
      throw new AppError("Exit not found", 404);
    }

    const logsDesc = await prisma.holdingExitLog.findMany({
      where: { exitId: exit.id },
      orderBy: { createdAt: "desc" },
      take: EXIT_LOG_WINDOW,
    });

    return {
      ...exit,
      logs: logsDesc.reverse(),
    };
  },

  async getActiveExit(input: ActiveExitInput, userId: string) {
    const exit = await prisma.holdingExit.findFirst({
      where: {
        userId,
        tokenPublicKey: input.tokenPublicKey,
        status: { in: ["PENDING", "RUNNING"] },
      },
      orderBy: { createdAt: "desc" },
    });
    if (!exit) {
      return null;
    }

    const logsDesc = await prisma.holdingExitLog.findMany({
      where: { exitId: exit.id },
      orderBy: { createdAt: "desc" },
      take: EXIT_LOG_WINDOW,
    });

    return {
      ...exit,
      logs: logsDesc.reverse(),
    };
  },

  async cancelExit(input: CancelExitInput, userId: string) {
    const exit = await prisma.holdingExit.findFirst({
      where: { id: input.exitId, userId },
    });

    if (!exit) {
      throw new AppError("Exit not found", 404);
    }

    if (exit.status !== "PENDING" && exit.status !== "RUNNING") {
      throw new AppError("Exit cannot be cancelled", 400);
    }

    markExitCancelled(exit.id);

    await appendExitLog(exit.id, "WARN", "Exit cancelled by user", "cancel");
    await updateExit(exit.id, {
      status: "FAILED",
      errorMessage: "Cancelled by user",
      completedAt: new Date(),
    });
    invalidateStatsCache(exit.tokenPublicKey);

    return { success: true };
  },
};
