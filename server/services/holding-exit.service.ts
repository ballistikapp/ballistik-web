import { prisma } from "@/lib/prisma";
import { AppError } from "@/server/errors";
import { getSolanaConnection } from "@/lib/solana/connection";
import { rpcConfig } from "@/lib/config/rpc.config";
import { refreshCacheService } from "@/server/services/refresh-cache.service";
import { mapWithConcurrency } from "@/lib/utils/async";
import { getPumpProgram } from "@/server/solana/pump-idl";
import { sellTokensWithNewIdl } from "@/server/solana/pump-new-idl";
import { sendJitoBundle } from "@/server/solana/jito-bundle";
import { AnchorProvider, BN } from "@coral-xyz/anchor";
import NodeWallet from "@coral-xyz/anchor/dist/cjs/nodewallet";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
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
};

type WalletBalance = {
  wallet: WalletRecord;
  balance: bigint;
};

type ExitSummary = {
  totalWallets: number;
  totalChunks: number;
  totalTokensRaw: string;
  totalTokensUi: number;
  tokenDecimals: number;
  bundlesProcessed: number;
  walletsFunded: number;
  fundingLamports: number;
  atasClosed: number;
  solRecoveredLamports: number;
  solRecoveredSol: number;
};

const DEFAULT_JITO_TIP_SOL = 0.005;
const MAX_BUNDLE_TXS = 5;
const MIN_RENT_LAMPORTS = 2_100_000;
const FUND_AMOUNT_LAMPORTS = 5_000_000;

async function appendExitLog(
  exitId: string,
  level: "INFO" | "WARN" | "ERROR" | "STEP",
  message: string,
  step?: string,
  data?: Record<string, unknown>
) {
  await prisma.holdingExitLog.create({
    data: {
      exitId,
      level,
      message,
      step: step ?? null,
      data: data ?? null,
    },
  });
}

async function updateExit(
  exitId: string,
  data: Partial<{
    status: "PENDING" | "RUNNING" | "FAILED" | "SUCCEEDED";
    progress: number;
    currentStep: string | null;
    result: ExitSummary | null;
    errorMessage: string | null;
    startedAt: Date | null;
    completedAt: Date | null;
  }>
) {
  await prisma.holdingExit.update({
    where: { id: exitId },
    data,
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
      select: { publicKey: true, privateKey: true },
    }),
    prisma.tokenDevWallet.findFirst({
      where: { tokenPublicKey },
      select: { wallet: { select: { publicKey: true, privateKey: true } } },
    }),
    prisma.user.findUnique({
      where: { id: userId },
      select: {
        mainWallet: { select: { publicKey: true, privateKey: true } },
      },
    }),
  ]);

  const mainWallet = user?.mainWallet;
  if (!mainWallet) {
    throw new AppError("Main wallet not found", 400);
  }

  const allWallets: WalletRecord[] = [
    mainWallet,
    ...(devWallet?.wallet ? [devWallet.wallet] : []),
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

  const ataAddresses = atas.map((a) => a.ata);
  const accountInfos = await connection.getMultipleAccountsInfo(ataAddresses);

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
}: {
  wallets: WalletRecord[];
  mainWallet: Keypair;
  exitId: string;
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
      await sendAndConfirmTransaction(connection, tx, [mainWallet], {
        commitment: "confirmed",
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
  const senderGroups = chunkWallets(senders, 5);
  const lastGroup = senderGroups.pop() ?? [];
  const groups = [...senderGroups, lastGroup];
  const transactions: Transaction[] = [];
  const signerGroups: Keypair[][] = [];

  const ensureSellerAta = !sellerAtaExists;
  const provider = new AnchorProvider(
    connection,
    new NodeWallet(sellerKeypair),
    { commitment: "finalized" }
  );
  const program = getPumpProgram(provider);

  for (let groupIndex = 0; groupIndex < groups.length; groupIndex += 1) {
    const group = groups[groupIndex];
    const isFinal = groupIndex === groups.length - 1;
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

    if (isFinal) {
      const sellTx = await sellTokensWithNewIdl(
        program,
        sellerKeypair,
        mint,
        new BN(totalAmount.toString()),
        new BN(0)
      );
      sellTx.instructions.forEach((instruction) => {
        tx.add(instruction);
      });
    }

    tx.feePayer = mainWallet.publicKey;
    transactions.push(tx);

    const signers = [mainWallet, ...transferSigners];
    if (isFinal) {
      signers.push(sellerKeypair);
    }
    signerGroups.push(signers);
  }

  if (transactions.length > MAX_BUNDLE_TXS) {
    throw new AppError("Exit bundle exceeds max transaction count", 400);
  }

  return { transactions, signerGroups };
}

async function closeAtasAndRecoverSol({
  wallets,
  mint,
  mainWallet,
}: {
  wallets: WalletRecord[];
  mint: PublicKey;
  mainWallet: Keypair;
}) {
  const connection = getSolanaConnection();
  const latestBlockhash = await connection.getLatestBlockhash("confirmed");
  let atasClosed = 0;
  let solRecoveredLamports = 0;

  for (const wallet of wallets) {
    if (wallet.publicKey === mainWallet.publicKey.toBase58()) {
      continue;
    }

    const owner = Keypair.fromSecretKey(bs58.decode(wallet.privateKey));
    const ata = await getAssociatedTokenAddress(mint, owner.publicKey);

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
      try {
        const closeTx = new Transaction().add(
          createCloseAccountInstruction(
            ata,
            mainWallet.publicKey,
            owner.publicKey
          )
        );
        closeTx.recentBlockhash = latestBlockhash.blockhash;
        closeTx.feePayer = mainWallet.publicKey;
        await sendAndConfirmTransaction(connection, closeTx, [
          mainWallet,
          owner,
        ]);
        atasClosed += 1;
      } catch (error) {
        logger.warn("Failed to close ATA", {
          wallet: wallet.publicKey,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    try {
      const balanceLamports = await connection.getBalance(owner.publicKey);
      const feeTransaction = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: owner.publicKey,
          toPubkey: mainWallet.publicKey,
          lamports: 1,
        })
      );
      feeTransaction.recentBlockhash = latestBlockhash.blockhash;
      feeTransaction.feePayer = owner.publicKey;
      const fee = await connection.getFeeForMessage(
        feeTransaction.compileMessage(),
        "confirmed"
      );
      const feeLamports = fee.value ?? 5000;
      const lamports = balanceLamports - feeLamports;
      if (lamports <= 0) {
        continue;
      }
      const transferTx = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: owner.publicKey,
          toPubkey: mainWallet.publicKey,
          lamports,
        })
      );
      transferTx.recentBlockhash = latestBlockhash.blockhash;
      transferTx.feePayer = owner.publicKey;
      await sendAndConfirmTransaction(connection, transferTx, [owner], {
        commitment: "confirmed",
      });
      solRecoveredLamports += lamports;
    } catch (error) {
      logger.warn("Failed to recover SOL", {
        wallet: wallet.publicKey,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { atasClosed, solRecoveredLamports };
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
      return;
    }

    const chunks = chunkWallets(nonZeroBalances, 24);
    const totalTokens = nonZeroBalances.reduce(
      (total, entry) => total + entry.balance,
      BigInt(0)
    );
    const jitoTipSol =
      typeof exit.input === "object" && exit.input
        ? Number((exit.input as { jitoTipSol?: number }).jitoTipSol ?? 0)
        : DEFAULT_JITO_TIP_SOL;
    const tipLamports = Math.max(0, Math.floor(jitoTipSol * 1_000_000_000));

    await appendExitLog(exitId, "INFO", "Exit chunks prepared", "chunking", {
      chunkCount: chunks.length,
      totalWallets: nonZeroBalances.length,
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
      });

    checkCancelled();

    let bundlesProcessed = 0;
    for (let index = 0; index < chunks.length; index += 1) {
      checkCancelled();

      const chunk = chunks[index];
      const seller = chunk[0]?.wallet;
      if (!seller) {
        continue;
      }
      const chunkTotal = chunk.reduce(
        (total, entry) => total + entry.balance,
        BigInt(0)
      );
      const progress = Math.min(
        90,
        15 + Math.floor(((index + 1) / chunks.length) * 75)
      );
      await updateExit(exitId, {
        progress,
        currentStep: `Processing chunk ${index + 1}/${chunks.length}`,
      });
      await appendExitLog(
        exitId,
        "STEP",
        `Processing chunk ${index + 1}/${chunks.length}`,
        "bundle",
        { seller: seller.publicKey }
      );

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

      const bundleResult = await sendJitoBundle(
        transactions,
        signerGroups,
        mainKeypair,
        tipLamports
      );
      bundlesProcessed += 1;
      await appendExitLog(exitId, "INFO", "Bundle submitted", "bundle", {
        bundleId: bundleResult.bundleId,
        signatures: bundleResult.signatures,
      });
    }

    await updateExit(exitId, {
      progress: 92,
      currentStep: "Closing ATAs",
    });
    await appendExitLog(exitId, "STEP", "Closing ATAs", "cleanup");

    const { atasClosed, solRecoveredLamports } = await closeAtasAndRecoverSol({
      wallets: nonZeroBalances.map((entry) => entry.wallet),
      mint,
      mainWallet: mainKeypair,
    });

    await updateExit(exitId, {
      progress: 98,
      currentStep: "Recovering SOL",
    });
    await appendExitLog(exitId, "STEP", "Recovering SOL", "cleanup", {
      solRecoveredLamports,
    });

    const summary: ExitSummary = {
      totalWallets: nonZeroBalances.length,
      totalChunks: chunks.length,
      totalTokensRaw: totalTokens.toString(),
      totalTokensUi: formatTokens(totalTokens, decimals),
      tokenDecimals: decimals,
      bundlesProcessed,
      walletsFunded,
      fundingLamports,
      atasClosed,
      solRecoveredLamports,
      solRecoveredSol: solRecoveredLamports / 1_000_000_000,
    };

    await updateExit(exitId, {
      status: "SUCCEEDED",
      progress: 100,
      currentStep: "Complete",
      completedAt: new Date(),
      result: summary,
    });
    await appendExitLog(exitId, "INFO", "Exit completed", "complete", summary);

    await refreshCacheService.touch({
      userId: exit.userId,
      tokenPublicKey: exit.tokenPublicKey,
      scope: "HOLDINGS",
    });
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
  }
}

export const holdingExitService = {
  async startExit(input: StartExitInput, userId: string) {
    const existing = await prisma.holdingExit.findFirst({
      where: {
        userId,
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
        userId,
        tokenPublicKey: input.tokenPublicKey,
        status: "PENDING",
        progress: 0,
        currentStep: "Queued",
        input,
      },
    });

    await appendExitLog(exit.id, "STEP", "Exit queued", "queue");
    void runExitFlow(exit.id);

    return { exitId: exit.id };
  },

  async getExitStatus(input: ExitStatusInput, userId: string) {
    const exit = await prisma.holdingExit.findFirst({
      where: { id: input.exitId, userId },
      include: { logs: { orderBy: { createdAt: "asc" } } },
    });
    if (!exit) {
      throw new AppError("Exit not found", 404);
    }
    return exit;
  },

  async getActiveExit(input: ActiveExitInput, userId: string) {
    const exit = await prisma.holdingExit.findFirst({
      where: {
        userId,
        tokenPublicKey: input.tokenPublicKey,
        status: { in: ["PENDING", "RUNNING"] },
      },
      orderBy: { createdAt: "desc" },
      include: { logs: { orderBy: { createdAt: "asc" } } },
    });
    return exit ?? null;
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

    return { success: true };
  },
};
