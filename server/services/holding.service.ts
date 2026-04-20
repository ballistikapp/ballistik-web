import "server-only";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/lib/generated/prisma/client";
import { rpcConfig } from "@/lib/config/rpc.config";
import { AppError } from "@/server/errors";
import { getSolanaConnection } from "@/lib/solana/connection";
import { refreshCacheService } from "@/server/services/refresh-cache.service";
import { walletService } from "@/server/services/wallet.service";
import { retryRpc, retryRpcWithTimeout } from "@/lib/utils/rpc-retry";
import {
  Keypair,
  PublicKey,
  Transaction,
  sendAndConfirmTransaction,
  type Connection,
} from "@solana/web3.js";
import {
  createCloseAccountInstruction,
  getAccount,
  getAssociatedTokenAddress,
} from "@solana/spl-token";
import bs58 from "bs58";
import { type WalletType } from "@/lib/generated/prisma/enums";
import { mapWithConcurrency } from "@/lib/utils/async";
import { appTransactionService } from "@/server/services/app-transaction.service";
import {
  buildSellTransaction,
  getTokenProgramIdForPumpMint,
} from "@/server/solana/pump-new-idl";
import { testRunLogService } from "@/server/services/test-run-log.service";
import {
  recoverWalletSolBalances,
  resolveReturnSolToMainWallet,
  sweepSystemDevRealizedSol,
} from "@/server/services/holding-sol-recovery";
import type {
  ListHoldingsByTokenInput,
  RefreshHoldingsByTokenInput,
  SellHoldingsByTokenInput,
} from "@/server/schemas/holding.schema";
import { invalidateStatsCache } from "@/server/services/dashboard.service";
import { getEnv } from "@/lib/config/env";

type WalletRecord = {
  publicKey: string;
  type: WalletType;
};

type WalletWithKey = WalletRecord & {
  privateKey: string;
  isSystemWallet?: boolean;
};

const HOLDING_MUTATION_BATCH_SIZE = 100;
const HOLDING_UPDATE_BATCH_SIZE = 50;
const HOLDING_RPC_BATCH_SIZE = 100;
const HOLDING_RPC_CONCURRENCY = 3;
const HOLDING_MUTATION_CONCURRENCY = 3;
const TOKEN_SUPPLY_CACHE_TTL_MS = 10_000;
const TOKEN_SUPPLY_CACHE_MAX_SIZE = 200;
const MONITORING_REFRESH_MIN_INTERVAL_MS = 12_000;

const tokenSupplyCache = new Map<
  string,
  { value: number; cachedAt: number }
>();
const monitoringRefreshState = new Map<
  string,
  {
    inFlight: Promise<void> | null;
    lastCompletedAt: number;
  }
>();

type HoldingRowLike = {
  id: string;
  walletPublicKey: string;
  lastUpdated: Date;
  createdAt: Date;
};

function dedupeWalletsByPublicKey<T extends { publicKey: string }>(wallets: T[]) {
  return Array.from(
    new Map(wallets.map((wallet) => [wallet.publicKey, wallet])).values()
  );
}

function compareHoldingsByRecency<T extends HoldingRowLike>(a: T, b: T) {
  const lastUpdatedDiff = b.lastUpdated.getTime() - a.lastUpdated.getTime();
  if (lastUpdatedDiff !== 0) return lastUpdatedDiff;

  const createdAtDiff = b.createdAt.getTime() - a.createdAt.getTime();
  if (createdAtDiff !== 0) return createdAtDiff;

  return b.id.localeCompare(a.id);
}

function splitHoldingsByWallet<T extends HoldingRowLike>(holdings: T[]) {
  const holdingsByWallet = new Map<string, T[]>();

  for (const holding of holdings) {
    const existing = holdingsByWallet.get(holding.walletPublicKey) ?? [];
    existing.push(holding);
    holdingsByWallet.set(holding.walletPublicKey, existing);
  }

  const canonicalByWallet = new Map<string, T>();
  const duplicateIdsByWallet = new Map<string, string[]>();

  for (const [walletPublicKey, walletHoldings] of holdingsByWallet) {
    const sorted = [...walletHoldings].sort(compareHoldingsByRecency);
    const canonical = sorted[0];

    if (!canonical) continue;

    canonicalByWallet.set(walletPublicKey, canonical);
    duplicateIdsByWallet.set(
      walletPublicKey,
      sorted.slice(1).map((holding) => holding.id)
    );
  }

  return {
    canonicalByWallet,
    duplicateIdsByWallet,
  };
}

function dedupeHoldingRows<T extends HoldingRowLike>(holdings: T[]) {
  return Array.from(splitHoldingsByWallet(holdings).canonicalByWallet.values()).sort(
    compareHoldingsByRecency
  );
}

type MonitoringRefreshResult =
  | { status: "refreshed"; startedAt: number; completedAt: number }
  | {
      status: "skipped-fresh";
      lastCompletedAt: number;
      minIntervalMs: number;
    }
  | { status: "joined-inflight" };

async function getAllowedWallets(
  tokenPublicKey: string,
  userId: string,
  walletPublicKeys?: string[]
) {
  const token = await prisma.token.findFirst({
    where: { publicKey: tokenPublicKey, userId },
    select: {
      publicKey: true,
      name: true,
      symbol: true,
      imageUrl: true,
    },
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
      select: { publicKey: true, type: true },
    }),
    prisma.tokenDevWallet.findFirst({
      where: { tokenPublicKey },
      select: { wallet: { select: { publicKey: true, type: true } } },
    }),
    prisma.user.findUnique({
      where: { id: userId },
      select: { mainWallet: { select: { publicKey: true, type: true } } },
    }),
  ]);

  const allWallets = dedupeWalletsByPublicKey<WalletRecord>([
    ...(user?.mainWallet ? [user.mainWallet] : []),
    ...(devWallet?.wallet ? [devWallet.wallet] : []),
    ...operationalWallets,
  ]);

  const walletSet = walletPublicKeys?.length ? new Set(walletPublicKeys) : null;
  const filteredWallets = walletSet
    ? allWallets.filter((wallet) => walletSet.has(wallet.publicKey))
    : allWallets;

  return { token, wallets: filteredWallets };
}

async function getAllowedWalletsWithKeys(
  tokenPublicKey: string,
  userId: string,
  walletPublicKeys?: string[]
) {
  const token = await prisma.token.findFirst({
    where: { publicKey: tokenPublicKey, userId },
    select: {
      publicKey: true,
      name: true,
      symbol: true,
      imageUrl: true,
    },
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
      select: { publicKey: true, type: true, privateKey: true, isSystemWallet: true },
    }),
    prisma.tokenDevWallet.findFirst({
      where: { tokenPublicKey },
      select: {
        wallet: { select: { publicKey: true, type: true, privateKey: true, isSystemWallet: true } },
      },
    }),
    prisma.user.findUnique({
      where: { id: userId },
      select: {
        mainWallet: {
          select: { publicKey: true, type: true, privateKey: true, isSystemWallet: true },
        },
      },
    }),
  ]);

  const resolvedDevWallet = devWallet?.wallet
    ? devWallet.wallet.isSystemWallet
      ? { ...devWallet.wallet, privateKey: getEnv().SYSTEM_DEV_WALLET_PRIVATE_KEY, isSystemWallet: true as const }
      : devWallet.wallet
    : null;

  const allWallets = [
    ...(user?.mainWallet ? [user.mainWallet] : []),
    ...(resolvedDevWallet ? [resolvedDevWallet] : []),
    ...operationalWallets,
  ];

  const walletMap = new Map<string, WalletWithKey>();
  allWallets.forEach((wallet) => {
    if (wallet.privateKey) {
      walletMap.set(wallet.publicKey, {
        publicKey: wallet.publicKey,
        type: wallet.type,
        privateKey: wallet.privateKey,
        isSystemWallet: wallet.isSystemWallet,
      });
    }
  });

  const filteredWallets = walletPublicKeys?.length
    ? walletPublicKeys
        .map((publicKey) => walletMap.get(publicKey))
        .filter((wallet): wallet is WalletWithKey => Boolean(wallet))
    : Array.from(walletMap.values());

  return { token, wallets: filteredWallets };
}

async function getTokenBalanceForWallet(
  connection: Connection,
  walletPublicKey: string,
  mintPublicKey: PublicKey
) {
  try {
    const owner = new PublicKey(walletPublicKey);
    const tokenProgramId = await getTokenProgramIdForPumpMint(mintPublicKey);
    const ata = await getAssociatedTokenAddress(
      mintPublicKey,
      owner,
      false,
      tokenProgramId
    );
    const account = await getAccount(
      connection,
      ata,
      "confirmed",
      tokenProgramId
    );
    return account.amount;
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message.includes("Account does not exist") ||
        error.message.includes("could not find account") ||
        error.name === "TokenAccountNotFoundError")
    ) {
      return BigInt(0);
    }
    throw error;
  }
}

async function getCachedTokenSupply(
  connection: Connection,
  mintKey: string
): Promise<number | null> {
  const cached = tokenSupplyCache.get(mintKey);
  if (cached && Date.now() - cached.cachedAt < TOKEN_SUPPLY_CACHE_TTL_MS) {
    return cached.value;
  }

  try {
    const supply = await retryRpcWithTimeout(
      () => connection.getTokenSupply(new PublicKey(mintKey)),
      rpcConfig.tuning.rpcTimeoutMs
    );
    const value = Number(supply.value.uiAmountString ?? "0");
    tokenSupplyCache.set(mintKey, { value, cachedAt: Date.now() });
    if (tokenSupplyCache.size > TOKEN_SUPPLY_CACHE_MAX_SIZE) {
      const oldestKey = tokenSupplyCache.keys().next().value;
      if (oldestKey) {
        tokenSupplyCache.delete(oldestKey);
      }
    }
    return value;
  } catch {
    return cached?.value ?? null;
  }
}

type BalanceResult = {
  wallet: WalletRecord;
  tokenBalance: number;
  ataExists: boolean;
  isResolved: boolean;
};

async function fetchBalancesViaRpc(
  wallets: WalletRecord[],
  tokenPublicKey: string
): Promise<{ results: BalanceResult[]; mintDecimals: number }> {
  const connection = getSolanaConnection();
  const mintPubkey = new PublicKey(tokenPublicKey);
  const mintInfo = await connection.getParsedAccountInfo(mintPubkey);
  const mintDecimals =
    (
      mintInfo.value?.data as {
        parsed?: { info?: { decimals?: number } };
      }
    )?.parsed?.info?.decimals ?? 9;

  const tokenProgramId = mintInfo.value?.owner;
  if (!tokenProgramId) {
    throw new AppError("Mint account not found", 404);
  }

  const atas = await Promise.all(
    wallets.map(async (wallet) => ({
      wallet,
      ata: await getAssociatedTokenAddress(
        mintPubkey,
        new PublicKey(wallet.publicKey),
        false,
        tokenProgramId
      ),
    }))
  );

  type ParsedAccountInfoItem = Awaited<
    ReturnType<Connection["getMultipleParsedAccounts"]>
  >["value"][number];
  const ataAddresses = atas.map((a) => a.ata);
  const ataBatches: PublicKey[][] = [];
  for (let i = 0; i < ataAddresses.length; i += HOLDING_RPC_BATCH_SIZE) {
    ataBatches.push(ataAddresses.slice(i, i + HOLDING_RPC_BATCH_SIZE));
  }
  const batchedInfos = await mapWithConcurrency(
    ataBatches,
    HOLDING_RPC_CONCURRENCY,
    async (batch) =>
      await retryRpc(() => connection.getMultipleParsedAccounts(batch))
  );
  const accountInfos: ParsedAccountInfoItem[] = batchedInfos.flatMap(
    (batchInfo) => batchInfo.value
  );

  const results = atas.map(({ wallet }, index) => {
    const accountInfo = accountInfos[index];
    const ataExists = Boolean(accountInfo?.data);
    let tokenBalance = 0;
    if (accountInfo?.data && "parsed" in accountInfo.data) {
      const parsed = accountInfo.data.parsed as {
        info?: { tokenAmount?: { uiAmount?: number } };
      };
      tokenBalance = parsed?.info?.tokenAmount?.uiAmount ?? 0;
    }
    return { wallet, tokenBalance, ataExists, isResolved: true };
  });

  return { results, mintDecimals };
}

async function fetchBalances(
  wallets: WalletRecord[],
  tokenPublicKey: string
): Promise<{ results: BalanceResult[]; mintDecimals: number }> {
  return await fetchBalancesViaRpc(wallets, tokenPublicKey);
}

export const holdingService = {
  async listByToken(input: ListHoldingsByTokenInput, userId: string) {
    const token = await prisma.token.findFirst({
      where: { publicKey: input.tokenPublicKey, userId },
      select: { publicKey: true },
    });

    if (!token) {
      throw new AppError("Token not found", 404);
    }

    const page = input.page ?? 1;
    const pageSize = input.pageSize ?? 25;
    const skip = (page - 1) * pageSize;
    const take = pageSize;
    const where = {
      tokenPublicKey: input.tokenPublicKey,
      ...(input.walletPublicKey ? { walletPublicKey: input.walletPublicKey } : {}),
    };

    const [allHoldings, totalSupply] = await Promise.all([
      prisma.holding.findMany({
        where,
        include: {
          wallet: {
            select: { publicKey: true, type: true },
          },
        },
        orderBy: [{ lastUpdated: "desc" }, { createdAt: "desc" }],
      }),
      (async () => {
        try {
          const connection = getSolanaConnection();
          return await getCachedTokenSupply(connection, input.tokenPublicKey);
        } catch {
          return null;
        }
      })(),
    ]);

    const dedupedHoldings = dedupeHoldingRows(allHoldings);
    const holdings = dedupedHoldings.slice(skip, skip + take);
    const totalCount = dedupedHoldings.length;
    const totalBalance = dedupedHoldings.reduce(
      (sum, holding) => sum + Number(holding.tokenBalance),
      0
    );
    const walletsWithBalance = dedupedHoldings.filter(
      (holding) =>
        Number.isFinite(Number(holding.tokenBalance)) &&
        Number(holding.tokenBalance) > 0
    ).length;

    return {
      holdings,
      totalCount,
      totalBalance,
      walletsWithBalance,
      totalSupply,
    };
  },

  async refreshByToken(input: RefreshHoldingsByTokenInput, userId: string) {
    const { token, wallets } = await getAllowedWallets(
      input.tokenPublicKey,
      userId,
      input.walletPublicKeys
    );

    const walletPublicKeys = wallets.map((w) => w.publicKey);

    const [balanceResults, existingHoldings] = await Promise.all([
      fetchBalances(wallets, token.publicKey),
      prisma.holding.findMany({
        where: {
          walletPublicKey: { in: walletPublicKeys },
          tokenPublicKey: token.publicKey,
        },
        select: {
          id: true,
          walletPublicKey: true,
          tokenBalance: true,
          totalBuyAmount: true,
          totalSellAmount: true,
          averageBuyPrice: true,
          lastTransactionSignature: true,
          mintAddress: true,
          tokenName: true,
          tokenSymbol: true,
          tokenImageUrl: true,
          tokenDecimals: true,
          lastUpdated: true,
          createdAt: true,
        },
      }),
    ]);

    const { canonicalByWallet, duplicateIdsByWallet } =
      splitHoldingsByWallet(existingHoldings);

    const persistedCandidates = balanceResults.results.filter(
      (result) => result.isResolved && (result.tokenBalance > 0 || result.ataExists)
    );
    const candidateWalletPublicKeys = Array.from(
      new Set(persistedCandidates.map((result) => result.wallet.publicKey))
    );

    const lastTransactions =
      candidateWalletPublicKeys.length > 0
        ? await prisma.$queryRaw<
            Array<{ walletPublicKey: string; transactionSignature: string }>
          >`
              SELECT DISTINCT ON ("walletPublicKey") 
                "walletPublicKey", 
                "transactionSignature"
              FROM "Transaction"
              WHERE "walletPublicKey" = ANY(${candidateWalletPublicKeys})
                AND "tokenPublicKey" = ${token.publicKey}
              ORDER BY "walletPublicKey", "createdAt" DESC
            `
        : [];

    const lastTxMap = new Map<string, string>();
    for (const tx of lastTransactions) {
      lastTxMap.set(tx.walletPublicKey, tx.transactionSignature);
    }

    const mintDecimals = balanceResults.mintDecimals;
    const tokenImageUrl = token.imageUrl ?? "";
    const now = new Date();
    const createManyData: Prisma.HoldingCreateManyInput[] = [];
    const deleteIds: string[] = [];
    const updateInputs: Array<{
      id: string;
      data: Prisma.HoldingUpdateInput;
    }> = [];

    for (const { wallet, tokenBalance, ataExists, isResolved } of balanceResults.results) {
      if (!isResolved) {
        continue;
      }

      const shouldPersist = tokenBalance > 0 || ataExists;
      const existing = canonicalByWallet.get(wallet.publicKey);
      const duplicateIds = duplicateIdsByWallet.get(wallet.publicKey) ?? [];

      if (!shouldPersist) {
        if (existing) {
          deleteIds.push(existing.id);
        }
        deleteIds.push(...duplicateIds);
        continue;
      }

      const lastTxSignature = lastTxMap.get(wallet.publicKey) ?? "";
      const baseData = {
        tokenBalance,
        totalBuyAmount: 0,
        totalSellAmount: 0,
        averageBuyPrice: 0,
        lastTransactionSignature: lastTxSignature,
        mintAddress: token.publicKey,
        tokenName: token.name,
        tokenSymbol: token.symbol,
        tokenImageUrl,
        tokenDecimals: mintDecimals,
      };

      if (!existing) {
        createManyData.push({
          walletPublicKey: wallet.publicKey,
          tokenPublicKey: token.publicKey,
          ...baseData,
          lastUpdated: now,
        });
        deleteIds.push(...duplicateIds);
        continue;
      }

      const hasChanges =
        Number(existing.tokenBalance) !== tokenBalance ||
        Number(existing.totalBuyAmount) !== 0 ||
        Number(existing.totalSellAmount) !== 0 ||
        Number(existing.averageBuyPrice) !== 0 ||
        existing.lastTransactionSignature !== lastTxSignature ||
        existing.mintAddress !== token.publicKey ||
        existing.tokenName !== token.name ||
        existing.tokenSymbol !== token.symbol ||
        existing.tokenImageUrl !== tokenImageUrl ||
        existing.tokenDecimals !== mintDecimals;

      if (!hasChanges) {
        deleteIds.push(...duplicateIds);
        continue;
      }

      updateInputs.push({
        id: existing.id,
        data: {
          ...baseData,
          lastUpdated: now,
        },
      });
      deleteIds.push(...duplicateIds);
    }

    const uniqueDeleteIds = Array.from(new Set(deleteIds));

    if (uniqueDeleteIds.length > 0) {
      const deleteBatches: string[][] = [];
      for (
        let i = 0;
        i < uniqueDeleteIds.length;
        i += HOLDING_MUTATION_BATCH_SIZE
      ) {
        deleteBatches.push(
          uniqueDeleteIds.slice(i, i + HOLDING_MUTATION_BATCH_SIZE)
        );
      }
      await mapWithConcurrency(
        deleteBatches,
        HOLDING_MUTATION_CONCURRENCY,
        async (batch) =>
          await prisma.holding.deleteMany({
            where: { id: { in: batch } },
          })
      );
    }
    if (createManyData.length > 0) {
      const createBatches: Prisma.HoldingCreateManyInput[][] = [];
      for (
        let i = 0;
        i < createManyData.length;
        i += HOLDING_MUTATION_BATCH_SIZE
      ) {
        createBatches.push(
          createManyData.slice(i, i + HOLDING_MUTATION_BATCH_SIZE)
        );
      }
      await mapWithConcurrency(
        createBatches,
        HOLDING_MUTATION_CONCURRENCY,
        async (batch) =>
          await prisma.holding.createMany({
            data: batch,
          })
      );
    }
    if (updateInputs.length > 0) {
      const updateBatches: Array<typeof updateInputs> = [];
      for (let i = 0; i < updateInputs.length; i += HOLDING_UPDATE_BATCH_SIZE) {
        updateBatches.push(updateInputs.slice(i, i + HOLDING_UPDATE_BATCH_SIZE));
      }
      await mapWithConcurrency(
        updateBatches,
        HOLDING_MUTATION_CONCURRENCY,
        async (batch) =>
          await prisma.$transaction(
            batch.map((update) =>
              prisma.holding.update({
                where: { id: update.id },
                data: update.data,
              })
            )
          )
      );
    }

    await refreshCacheService.touch({
      userId,
      tokenPublicKey: token.publicKey,
      scope: "HOLDINGS",
    });
    invalidateStatsCache(token.publicKey);
  },

  async monitoringRefreshByToken(
    input: { tokenPublicKey: string; force?: boolean },
    userId: string
  ): Promise<MonitoringRefreshResult> {
    const key = `${userId}:${input.tokenPublicKey}`;
    const now = Date.now();
    const existing = monitoringRefreshState.get(key);

    if (existing?.inFlight) {
      await existing.inFlight;
      return { status: "joined-inflight" };
    }

    const lastCompletedAt = existing?.lastCompletedAt ?? 0;
    const minIntervalMs = MONITORING_REFRESH_MIN_INTERVAL_MS;
    if (!input.force && lastCompletedAt > 0 && now - lastCompletedAt < minIntervalMs) {
      return { status: "skipped-fresh", lastCompletedAt, minIntervalMs };
    }

    const startedAt = Date.now();
    const refreshPromise = this.refreshByToken(
      { tokenPublicKey: input.tokenPublicKey },
      userId
    );
    monitoringRefreshState.set(key, {
      inFlight: refreshPromise,
      lastCompletedAt,
    });

    try {
      await refreshPromise;
      const completedAt = Date.now();
      monitoringRefreshState.set(key, {
        inFlight: null,
        lastCompletedAt: completedAt,
      });
      return {
        status: "refreshed",
        startedAt,
        completedAt,
      };
    } catch (error) {
      monitoringRefreshState.set(key, {
        inFlight: null,
        lastCompletedAt,
      });
      throw error;
    }
  },

  async sellByToken(input: SellHoldingsByTokenInput, userId: string) {
    const { token, wallets } = await getAllowedWalletsWithKeys(
      input.tokenPublicKey,
      userId,
      input.walletPublicKeys
    );

    if (wallets.length === 0) {
      throw new AppError("No valid wallets selected", 400);
    }

    const connection = getSolanaConnection();
    const mintPublicKey = new PublicKey(token.publicKey);
    const sellPercentage = Math.floor(input.sellPercentage);
    const shouldCloseAta = Boolean(input.closeAta);
    const shouldReturnSolToMainWallet = resolveReturnSolToMainWallet(
      wallets,
      Boolean(input.returnSolToMainWallet)
    );
    const mainWalletRecord = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        mainWallet: {
          select: { publicKey: true, privateKey: true },
        },
      },
    });
    const mainWalletKeypair = mainWalletRecord?.mainWallet?.privateKey
      ? Keypair.fromSecretKey(
          bs58.decode(mainWalletRecord.mainWallet.privateKey)
        )
      : null;

    const tokenProgramIdForAta =
      await getTokenProgramIdForPumpMint(mintPublicKey);

    const results = await mapWithConcurrency(
      wallets,
      rpcConfig.tuning.sellConcurrency,
      async (wallet) => {
        let sellTrackId: string | null = null;
        try {
          const balance = await getTokenBalanceForWallet(
            connection,
            wallet.publicKey,
            mintPublicKey
          );
          if (balance <= BigInt(0)) {
            return {
              walletPublicKey: wallet.publicKey,
              status: "SKIPPED",
              error: "No balance",
              tokenBalanceBefore: balance.toString(),
              sellAmount: "0",
            };
          }

          const sellAmount = (balance * BigInt(sellPercentage)) / BigInt(100);
          if (sellAmount <= BigInt(0)) {
            return {
              walletPublicKey: wallet.publicKey,
              status: "SKIPPED",
              error: "Sell amount too small",
              tokenBalanceBefore: balance.toString(),
              sellAmount: sellAmount.toString(),
            };
          }

          await testRunLogService.appendServerEvent({
            eventType: "trade_attempt",
            source: "holding.service",
            tokenPublicKey: token.publicKey,
            action: "holding.sellByToken",
            userId,
            wallets: [wallet.publicKey],
            balancesBefore: {
              walletPublicKey: wallet.publicKey,
              tokenBalanceBefore: balance.toString(),
            },
            expectedValue: {
              sellPercentage,
              sellAmount: sellAmount.toString(),
              closeAta: shouldCloseAta,
              returnSolToMainWallet: shouldReturnSolToMainWallet,
            },
          });

          const seller = Keypair.fromSecretKey(bs58.decode(wallet.privateKey));
          const sellTx = await buildSellTransaction(
            seller,
            mintPublicKey,
            sellAmount
          );
          const feePayer =
            mainWalletKeypair &&
            mainWalletKeypair.publicKey.toBase58() !==
              seller.publicKey.toBase58()
              ? mainWalletKeypair
              : seller;
          const signers =
            feePayer.publicKey.toBase58() === seller.publicKey.toBase58()
              ? [seller]
              : [feePayer, seller];

          const { blockhash, lastValidBlockHeight } =
            await retryRpcWithTimeout(
              () => connection.getLatestBlockhash("confirmed"),
              rpcConfig.tuning.rpcTimeoutMs
            );
          sellTx.recentBlockhash = blockhash;
          sellTx.lastValidBlockHeight = lastValidBlockHeight;
          sellTx.feePayer = feePayer.publicKey;
          sellTrackId = await appTransactionService
            .create({
              userId,
              type: "TRADE_SELL",
              source: "HOLDING",
              tokenPublicKey: token.publicKey,
              walletPublicKey: wallet.publicKey,
              fromAddress: wallet.publicKey,
              solAmount: null,
              tokenAmount: Number(sellAmount),
            })
            .then((r) => r.id)
            .catch(() => null);
          const signature = await retryRpcWithTimeout(
            () =>
              sendAndConfirmTransaction(connection, sellTx, signers, {
                commitment: "confirmed",
              }),
            rpcConfig.tuning.confirmTimeoutMs
          );
          if (sellTrackId) await appTransactionService.confirm(sellTrackId, { signature }).catch(() => {});
          await testRunLogService.appendServerEvent({
            eventType: "wallet_transaction",
            source: "holding.service",
            tokenPublicKey: token.publicKey,
            action: "holding.sellTransaction",
            userId,
            wallets: [wallet.publicKey],
            signature,
            status: "submitted",
            expectedValue: {
              sellAmount: sellAmount.toString(),
              sellPercentage,
            },
            actualValue: {
              feePayerPublicKey: feePayer.publicKey.toBase58(),
            },
          });

          if (wallet.isSystemWallet && mainWalletKeypair) {
            try {
              await sweepSystemDevRealizedSol(
                {
                  connection,
                  sellSignature: signature,
                  systemDevKeypair: seller,
                  mainWalletKeypair,
                  source: "HOLDING",
                  logSource: "holding.service",
                  logAction: "holding.sweepSystemDevRealizedSol",
                  userId,
                  tokenPublicKey: token.publicKey,
                }
              );
            } catch (sweepError) {
              console.error(
                `[Sell] System dev SOL sweep failed for ${wallet.publicKey}: ${sweepError instanceof Error ? sweepError.message : String(sweepError)}`
              );
            }
          }

          return {
            walletPublicKey: wallet.publicKey,
            status: "SUBMITTED",
            signature,
            tokenBalanceBefore: balance.toString(),
            sellAmount: sellAmount.toString(),
            feePayerPublicKey: feePayer.publicKey.toBase58(),
          };
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          console.error(
            `[Sell] ${wallet.publicKey} FAILED for ${input.tokenPublicKey}: ${message}`
          );
          if (sellTrackId) await appTransactionService.fail(sellTrackId, { errorMessage: message }).catch(() => {});
          return {
            walletPublicKey: wallet.publicKey,
            status: "FAILED",
            error: message,
            tokenBalanceBefore: null,
            sellAmount: null,
          };
        }
      }
    );

    const ataCloseResults = shouldCloseAta
      ? await mapWithConcurrency(wallets, 2, async (wallet) => {
          try {
            const owner = Keypair.fromSecretKey(bs58.decode(wallet.privateKey));
            const ata = await getAssociatedTokenAddress(
              mintPublicKey,
              owner.publicKey,
              false,
              tokenProgramIdForAta
            );
            const feePayer =
              mainWalletKeypair &&
              mainWalletKeypair.publicKey.toBase58() !==
                owner.publicKey.toBase58()
                ? mainWalletKeypair
                : owner;
            const destination = mainWalletKeypair?.publicKey ?? owner.publicKey;
            let account;
            try {
              account = await getAccount(
                connection,
                ata,
                "confirmed",
                tokenProgramIdForAta
              );
            } catch (error) {
              if (
                error instanceof Error &&
                (error.message.includes("Account does not exist") ||
                  error.message.includes("could not find account") ||
                  error.name === "TokenAccountNotFoundError")
              ) {
                return {
                  walletPublicKey: wallet.publicKey,
                  status: "SKIPPED",
                  error: "ATA not found",
                };
              }
              throw error;
            }

            if (account.amount > BigInt(0)) {
              return {
                walletPublicKey: wallet.publicKey,
                status: "SKIPPED",
                error: "Balance not zero",
              };
            }

            const closeTx = new Transaction().add(
              createCloseAccountInstruction(
                ata,
                destination,
                owner.publicKey,
                [],
                tokenProgramIdForAta
              )
            );
            const { blockhash, lastValidBlockHeight } =
              await connection.getLatestBlockhash("confirmed");
            closeTx.recentBlockhash = blockhash;
            closeTx.lastValidBlockHeight = lastValidBlockHeight;
            closeTx.feePayer = feePayer.publicKey;
            const signers =
              feePayer.publicKey.toBase58() === owner.publicKey.toBase58()
                ? [feePayer]
                : [feePayer, owner];
            const closeTrackId = await appTransactionService
              .create({
                userId,
                type: "ACCOUNT_ATA_CLOSE",
                source: "HOLDING",
                tokenPublicKey: token.publicKey,
                walletPublicKey: wallet.publicKey,
                fromAddress: wallet.publicKey,
              })
              .then((r) => r.id)
              .catch(() => null);
            const signature = await sendAndConfirmTransaction(connection, closeTx, signers, {
              commitment: "confirmed",
            });
            if (closeTrackId) await appTransactionService.confirm(closeTrackId, { signature }).catch(() => {});
            await testRunLogService.appendServerEvent({
              eventType: "wallet_transaction",
              source: "holding.service",
              tokenPublicKey: token.publicKey,
              action: "holding.closeAta",
              wallets: [wallet.publicKey],
              signature,
              status: "submitted",
              actualValue: {
                walletPublicKey: wallet.publicKey,
                destination: destination.toBase58(),
              },
            });

            return { walletPublicKey: wallet.publicKey, status: "CLOSED" };
          } catch (error) {
            const message =
              error instanceof Error ? error.message : String(error);
            return {
              walletPublicKey: wallet.publicKey,
              status: "FAILED",
              error: message,
            };
          }
        })
      : [];

    if (shouldReturnSolToMainWallet && !mainWalletKeypair) {
      throw new AppError("Main wallet not found", 400);
    }

    const solRecovery =
      shouldReturnSolToMainWallet && mainWalletKeypair
        ? await recoverWalletSolBalances({
            connection,
            wallets,
            mainWalletKeypair,
            source: "HOLDING",
            logSource: "holding.service",
            logAction: "holding.returnSolToMainWallet",
            preserveRentExemptMinimum: true,
            userId,
            tokenPublicKey: input.tokenPublicKey,
          })
        : null;

    const refreshWalletPublicKeys = Array.from(
      new Set([
        ...wallets.map((wallet) => wallet.publicKey),
        ...(mainWalletKeypair ? [mainWalletKeypair.publicKey.toBase58()] : []),
      ])
    );
    if (refreshWalletPublicKeys.length > 0) {
      try {
        await walletService.refreshWalletBalances(
          token.publicKey,
          userId,
          refreshWalletPublicKeys,
          true,
          "holding.sellByToken"
        );
      } catch {}
    }

    const submitted = results.filter((result) => result.status === "SUBMITTED");
    const failed = results.filter((result) => result.status === "FAILED");
    const ataClosed = ataCloseResults.filter(
      (result) => result.status === "CLOSED"
    );
    const ataCloseFailed = ataCloseResults.filter(
      (result) => result.status === "FAILED"
    );

    await testRunLogService.appendServerEvent({
      eventType: "trade_result",
      source: "holding.service",
      tokenPublicKey: token.publicKey,
      action: "holding.sellByToken",
      userId,
      wallets: wallets.map((wallet) => wallet.publicKey),
      expectedValue: {
        sellPercentage,
        closeAta: shouldCloseAta,
        returnSolToMainWallet: shouldReturnSolToMainWallet,
      },
      actualValue: {
        submitted: submitted.length,
        failed: failed.length,
        ataClosed: ataClosed.length,
        ataCloseFailed: ataCloseFailed.length,
        recoveredWallets: solRecovery?.recovered ?? 0,
        solRecoveryResults: solRecovery?.results ?? null,
      },
      balancesBefore: results.map((result) => ({
        walletPublicKey: result.walletPublicKey,
        tokenBalanceBefore: result.tokenBalanceBefore,
        sellAmount: result.sellAmount,
      })),
      balancesAfter: null,
      summary: {
        resultCount: results.length,
        ataClose: shouldCloseAta
          ? {
              closed: ataClosed.length,
              failed: ataCloseFailed.length,
            }
          : null,
        solRecovery,
      },
    });

    return {
      tokenPublicKey: token.publicKey,
      effectiveReturnSolToMainWallet: shouldReturnSolToMainWallet,
      submitted: submitted.length,
      failed: failed.length,
      results,
      ataClose: shouldCloseAta
        ? {
            closed: ataClosed.length,
            failed: ataCloseFailed.length,
            results: ataCloseResults,
          }
        : null,
      solRecovery,
    };
  },
};

export type HoldingItem = Awaited<
  ReturnType<typeof holdingService.listByToken>
>["holdings"][number];
