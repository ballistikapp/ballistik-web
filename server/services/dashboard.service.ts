import { PublicKey } from "@solana/web3.js";
import { prisma, Prisma } from "@/lib/prisma";
import { AppError } from "@/server/errors";
import type {
  GetDashboardStatsInput,
  GetDefiPoolsInput,
} from "@/server/schemas/dashboard.schema";
import { priceService, type PriceResult } from "@/server/services/price.service";
import { holdersService } from "@/server/services/holders.service";
import { derivePumpAddresses } from "@/server/solana/pump-new-idl";
import { shyftDefiService } from "@/server/services/shyft-defi.service";
import { getEnv } from "@/lib/config/env";
import { logger } from "@/lib/logger";

const log = logger.child({ service: "dashboard" });

const PRICE_HISTORY_MAX_ROWS = 500;
const PRICE_HISTORY_TARGET_POINTS = 250;
const STATS_CACHE_TTL_MS = 10_000;

type CachedStats = {
  data: ReturnType<typeof buildStatsResponse> extends Promise<infer R> ? R : never;
  cachedAt: number;
};
const statsCache = new Map<string, CachedStats>();

export function invalidateStatsCache(tokenPublicKey: string) {
  const prefix = `${tokenPublicKey}:`;
  for (const key of statsCache.keys()) {
    if (key.startsWith(prefix)) {
      statsCache.delete(key);
    }
  }
}

const round4 = (n: number) => Math.round(n * 10000) / 10000;

function downsamplePriceHistory(
  points: Array<{ time: number; price: number }>,
  targetPoints: number
) {
  if (points.length <= targetPoints) return points;
  const bucketSize = Math.ceil(points.length / targetPoints);
  const sampled: Array<{ time: number; price: number }> = [];

  for (let i = 0; i < points.length; i += bucketSize) {
    const bucket = points.slice(i, i + bucketSize);
    if (bucket.length === 0) continue;
    const avgTime = Math.floor(
      bucket.reduce((sum, point) => sum + point.time, 0) / bucket.length
    );
    const avgPrice =
      bucket.reduce((sum, point) => sum + point.price, 0) / bucket.length;
    sampled.push({ time: avgTime, price: avgPrice });
  }

  return sampled;
}

async function getHeaderData(tokenPublicKey: string) {
  const [currentPrice, successfulLaunch, solPriceUsd] = await Promise.all([
    priceService.getCurrentPrice(tokenPublicKey),
    prisma.launch.findFirst({
      where: { tokenPublicKey, status: "SUCCEEDED" },
      select: { completedAt: true },
      orderBy: { completedAt: "desc" },
    }),
    priceService.getSolUsdPrice(),
  ]);

  return { currentPrice, successfulLaunch, solPriceUsd };
}

async function getWalletKeys(tokenPublicKey: string, userId: string) {
  const [operationalWalletKeys, devWalletKeys, mainWalletUser] =
    await Promise.all([
      prisma.wallet.findMany({
        where: {
          tokenPublicKey,
          type: { in: ["BUNDLER", "VOLUME", "DISTRIBUTION"] },
        },
        select: { publicKey: true },
      }),
      prisma.tokenDevWallet.findMany({
        where: { tokenPublicKey },
        select: { walletPublicKey: true },
      }),
      prisma.user.findUnique({
        where: { id: userId },
        select: { mainWalletPublicKey: true },
      }),
    ]);

  const userWalletPubkeys = new Set<string>();
  for (const w of operationalWalletKeys) userWalletPubkeys.add(w.publicKey);
  for (const dw of devWalletKeys)
    userWalletPubkeys.add(dw.walletPublicKey);
  if (mainWalletUser?.mainWalletPublicKey)
    userWalletPubkeys.add(mainWalletUser.mainWalletPublicKey);

  return { operationalWalletKeys, devWalletKeys, userWalletPubkeys };
}

async function getTreasuryData(tokenPublicKey: string, userId: string) {
  const [walletAgg, devWalletAgg, runningVolumeBots] = await Promise.all([
    prisma.wallet.aggregate({
      where: {
        tokenPublicKey,
        userId,
        type: { in: ["BUNDLER", "VOLUME", "DISTRIBUTION"] },
      },
      _sum: { balanceSol: true },
      _count: { publicKey: true },
    }),
    prisma.$queryRaw<Array<{ sum: Prisma.Decimal | null; count: bigint }>>`
      SELECT COALESCE(SUM(w."balanceSol"), 0) as sum, COUNT(*) as count
      FROM "TokenDevWallet" tdw
      JOIN "Wallet" w ON w."publicKey" = tdw."walletPublicKey"
      WHERE tdw."tokenPublicKey" = ${tokenPublicKey}
    `,
    prisma.volumeBotSession.count({
      where: { tokenPublicKey, userId, status: "RUNNING" },
    }),
  ]);

  const operationalSol = Number(walletAgg._sum.balanceSol ?? 0);
  const devSol = devWalletAgg[0] ? Number(devWalletAgg[0].sum ?? 0) : 0;
  const operationalCount = walletAgg._count.publicKey;
  const devCount = devWalletAgg[0] ? Number(devWalletAgg[0].count) : 0;

  return {
    totalSol: round4(operationalSol + devSol),
    operationalSol: round4(operationalSol),
    devSol: round4(devSol),
    walletCount: operationalCount + devCount,
    runningVolumeBots,
  };
}

async function getVolumeMetrics(tokenPublicKey: string) {
  const [ownedVolumeByType, marketVolumeByType, totalTxCount] =
    await Promise.all([
      prisma.tokenTransaction.groupBy({
        by: ["transactionType"],
        where: {
          tokenPublicKey,
          isOwned: true,
          status: "CONFIRMED",
          transactionType: { in: ["BUY", "SELL"] },
        },
        _sum: { solAmount: true },
      }),
      prisma.tokenTransaction.groupBy({
        by: ["transactionType"],
        where: {
          tokenPublicKey,
          status: "CONFIRMED",
          transactionType: { in: ["BUY", "SELL"] },
        },
        _sum: { solAmount: true },
      }),
      prisma.tokenTransaction.count({
        where: { tokenPublicKey },
      }),
    ]);

  const ownedBuy =
    ownedVolumeByType.find((v) => v.transactionType === "BUY");
  const ownedSell =
    ownedVolumeByType.find((v) => v.transactionType === "SELL");
  const marketBuy =
    marketVolumeByType.find((v) => v.transactionType === "BUY");
  const marketSell =
    marketVolumeByType.find((v) => v.transactionType === "SELL");

  const ownedBuyVolume = round4(Number(ownedBuy?._sum.solAmount ?? 0));
  const ownedSellVolume = round4(Number(ownedSell?._sum.solAmount ?? 0));
  const marketBuyVolume = round4(Number(marketBuy?._sum.solAmount ?? 0));
  const marketSellVolume = round4(Number(marketSell?._sum.solAmount ?? 0));

  return {
    ownedBuyVolume,
    ownedSellVolume,
    marketBuyVolume,
    marketSellVolume,
    totalTxCount,
  };
}

async function getHoldingsBreakdown(
  tokenPublicKey: string,
  userWalletPubkeys: Set<string>,
  priceSol: number,
  circulatingSupply: number,
  currentPrice: PriceResult | null
) {
  const walletFilter = Array.from(userWalletPubkeys);

  const [holdingAgg, userHoldings, topHolders] = await Promise.all([
    walletFilter.length > 0
      ? prisma.holding.aggregate({
          where: {
            tokenPublicKey,
            walletPublicKey: { in: walletFilter },
          },
          _sum: { tokenBalance: true },
        })
      : Promise.resolve({ _sum: { tokenBalance: null } }),
    walletFilter.length > 0
      ? prisma.holding.findMany({
          where: {
            tokenPublicKey,
            walletPublicKey: { in: walletFilter },
          },
          include: {
            wallet: {
              select: { publicKey: true, type: true, balanceSol: true },
            },
          },
        })
      : Promise.resolve([]),
    holdersService.getTopHolders(tokenPublicKey),
  ]);

  const totalTokenHoldings = Number(holdingAgg._sum.tokenBalance ?? 0);
  const tokenTotalSupply = currentPrice?.tokenTotalSupply ?? 0;
  const bondingCurveTokens = currentPrice?.realTokenReserves ?? 0;

  let bondingCurvePda: string | null = null;
  try {
    const mint = new PublicKey(tokenPublicKey);
    const { bondingCurve } = derivePumpAddresses(mint);
    bondingCurvePda = bondingCurve.toBase58();
  } catch {
    // ignore
  }

  const excludedAddresses = new Set<string>();
  if (bondingCurvePda) excludedAddresses.add(bondingCurvePda);
  for (const pk of userWalletPubkeys) excludedAddresses.add(pk);

  const userWalletRows = userHoldings
    .map((h) => {
      const tokenBalance = Number(h.tokenBalance);
      const holdingPercent =
        circulatingSupply > 0
          ? round4((tokenBalance / circulatingSupply) * 100)
          : 0;
      const valueSol = round4(tokenBalance * priceSol);
      return {
        publicKey: h.wallet.publicKey,
        type: h.wallet.type,
        tokenBalance,
        holdingPercent,
        valueSol,
        solBalance: round4(Number(h.wallet.balanceSol)),
      };
    })
    .sort((a, b) => b.holdingPercent - a.holdingPercent);

  const externalHolders = topHolders
    .filter((h) => !excludedAddresses.has(h.ownerWallet))
    .map((h) => ({
      ownerWallet: h.ownerWallet,
      tokenBalance: h.tokenBalance,
      holdingPercent:
        circulatingSupply > 0
          ? round4((h.tokenBalance / circulatingSupply) * 100)
          : 0,
      valueSol: round4(h.tokenBalance * priceSol),
    }));

  const userTotalTokens = userWalletRows.reduce(
    (sum, w) => sum + w.tokenBalance,
    0
  );
  const userOwnershipPercent =
    circulatingSupply > 0
      ? round4((userTotalTokens / circulatingSupply) * 100)
      : 0;

  return {
    tokenTotalSupply,
    bondingCurveTokens,
    circulatingSupply,
    userTotalTokens,
    userOwnershipPercent,
    userWallets: userWalletRows,
    externalHolders,
    totalTokenHoldings,
    holdingsValueSol: round4(totalTokenHoldings * priceSol),
  };
}

async function getOperations(tokenPublicKey: string, userId: string) {
  const volumeBotSessions = await prisma.volumeBotSession.findMany({
    where: { tokenPublicKey, userId },
    orderBy: { updatedAt: "desc" },
    take: 10,
    select: {
      id: true,
      status: true,
      totalTrades: true,
      totalVolumeUsd: true,
      totalPnlSol: true,
      runtimeSeconds: true,
      startedAt: true,
      stoppedAt: true,
      lastTickAt: true,
      createdAt: true,
      wallets: {
        select: {
          walletPublicKey: true,
          status: true,
          tradesExecuted: true,
          pnlSol: true,
          solBalance: true,
          tokenBalance: true,
          lastTradeAt: true,
        },
      },
    },
  });

  return {
    botSessions: volumeBotSessions.map((s) => ({
      id: s.id,
      status: s.status,
      totalTrades: s.totalTrades,
      totalPnlSol: Number(s.totalPnlSol),
      runtimeSeconds: s.runtimeSeconds,
      startedAt: s.startedAt,
      stoppedAt: s.stoppedAt,
      lastTickAt: s.lastTickAt,
      walletCount: s.wallets.length,
      activeWallets: s.wallets.filter((w) => w.status === "ACTIVE").length,
    })),
  };
}

async function getRecentTransactions(tokenPublicKey: string) {
  const { bondingCurve } = derivePumpAddresses(
    new PublicKey(tokenPublicKey)
  );
  const bondingCurvePublicKey = bondingCurve.toBase58();

  return prisma.$queryRaw<
    Array<{
      id: string;
      walletPublicKey: string;
      walletType: string | null;
      isOwned: boolean;
      transactionType: "BUY" | "SELL";
      status: "PENDING" | "CONFIRMED" | "FAILED";
      solAmount: number;
      tokenAmount: number;
      pricePerToken: number;
      transactionSignature: string;
      blockTime: Date | null;
      createdAt: Date;
    }>
  >`
    SELECT *
    FROM (
      SELECT DISTINCT ON (tt."transactionSignature")
        tt."id",
        tt."walletPublicKey",
        tt."walletType",
        tt."isOwned",
        tt."transactionType",
        tt."status",
        tt."solAmount"::double precision AS "solAmount",
        tt."tokenAmount"::double precision AS "tokenAmount",
        tt."pricePerToken"::double precision AS "pricePerToken",
        tt."transactionSignature",
        tt."blockTime",
        tt."createdAt"
      FROM "TokenTransaction" tt
      WHERE tt."tokenPublicKey" = ${tokenPublicKey}
        AND tt."transactionType" IN ('BUY', 'SELL')
      ORDER BY
        tt."transactionSignature",
        CASE WHEN tt."walletPublicKey" = ${bondingCurvePublicKey} THEN 1 ELSE 0 END ASC,
        CASE WHEN tt."walletType" IS NULL THEN 1 ELSE 0 END ASC,
        COALESCE(tt."blockTime", tt."createdAt") DESC
    ) grouped
    ORDER BY COALESCE(grouped."blockTime", grouped."createdAt") DESC
    LIMIT 15
  `;
}

async function getPriceHistory(tokenPublicKey: string) {
  const transactions = await prisma.tokenTransaction.findMany({
    where: {
      tokenPublicKey,
      transactionType: { in: ["BUY", "SELL"] },
      status: "CONFIRMED",
    },
    select: {
      solAmount: true,
      tokenAmount: true,
      blockTime: true,
      createdAt: true,
    },
    orderBy: [{ blockTime: "asc" }, { createdAt: "asc" }],
    take: PRICE_HISTORY_MAX_ROWS,
  });

  const points = transactions
    .map((tx) => {
      const solAmt = Number(tx.solAmount);
      const tokenAmt = Number(tx.tokenAmount);
      if (tokenAmt <= 0 || solAmt <= 0) return null;
      const effectiveTime = tx.blockTime ?? tx.createdAt;
      return {
        time: Math.floor(effectiveTime.getTime() / 1000),
        price: solAmt / tokenAmt,
      };
    })
    .filter((p): p is { time: number; price: number } => p !== null);

  if (points.length < 3) return points;

  const sorted = points.map((p) => p.price).sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const lowerBound = median / 20;
  const upperBound = median * 20;

  const filteredPoints = points.filter(
    (p) => p.price >= lowerBound && p.price <= upperBound
  );
  return downsamplePriceHistory(filteredPoints, PRICE_HISTORY_TARGET_POINTS);
}

async function buildStatsResponse(
  tokenPublicKey: string,
  userId: string
) {
  const [headerData, walletKeys] = await Promise.all([
    getHeaderData(tokenPublicKey),
    getWalletKeys(tokenPublicKey, userId),
  ]);

  const { currentPrice, successfulLaunch, solPriceUsd } = headerData;
  const { userWalletPubkeys } = walletKeys;
  const priceSol = currentPrice?.priceSol ?? 0;
  const tokenTotalSupply = currentPrice?.tokenTotalSupply ?? 0;
  const bondingCurveTokens = currentPrice?.realTokenReserves ?? 0;
  const circulatingSupply = tokenTotalSupply - bondingCurveTokens;

  const defaultTreasury = {
    totalSol: 0, operationalSol: 0, devSol: 0, walletCount: 0, runningVolumeBots: 0,
  };
  const defaultVolumes = {
    ownedBuyVolume: 0, ownedSellVolume: 0, marketBuyVolume: 0, marketSellVolume: 0, totalTxCount: 0,
  };
  type HoldingsResult = Awaited<ReturnType<typeof getHoldingsBreakdown>>;
  const defaultHoldings: HoldingsResult = {
    tokenTotalSupply: currentPrice?.tokenTotalSupply ?? 0,
    bondingCurveTokens: currentPrice?.realTokenReserves ?? 0,
    circulatingSupply,
    userTotalTokens: 0, userOwnershipPercent: 0, userWallets: [],
    externalHolders: [], totalTokenHoldings: 0, holdingsValueSol: 0,
  };

  const isComplete = currentPrice?.isComplete ?? false;

  const results = await Promise.allSettled([
    getTreasuryData(tokenPublicKey, userId),
    getVolumeMetrics(tokenPublicKey),
    getHoldingsBreakdown(tokenPublicKey, userWalletPubkeys, priceSol, circulatingSupply, currentPrice),
    getOperations(tokenPublicKey, userId),
    getRecentTransactions(tokenPublicKey),
    isComplete ? Promise.resolve([]) : getPriceHistory(tokenPublicKey),
  ]);

  const treasury = results[0].status === "fulfilled" ? results[0].value : defaultTreasury;
  const volumes = results[1].status === "fulfilled" ? results[1].value : defaultVolumes;
  const holdingsBreakdown = results[2].status === "fulfilled" ? results[2].value : defaultHoldings;
  const operations = results[3].status === "fulfilled" ? results[3].value : { botSessions: [] };
  const recentTransactions = results[4].status === "fulfilled" ? results[4].value : [];
  const priceHistory = results[5].status === "fulfilled" ? results[5].value : [];

  for (const [i, r] of results.entries()) {
    if (r.status === "rejected") {
      const names = ["treasury", "volumes", "holdings", "operations", "transactions", "priceHistory"];
      log.error(`Dashboard sub-query failed: ${names[i]}`, {
        tokenPublicKey,
        error: r.reason instanceof Error ? r.reason.message : r.reason,
      });
    }
  }

  const holdingsValue = holdingsBreakdown.holdingsValueSol;
  const pnl = round4(
    volumes.ownedSellVolume + holdingsValue - volumes.ownedBuyVolume
  );

  const marketCapSol = round4(priceSol * tokenTotalSupply);

  return {
    header: {
      priceSol,
      solPriceUsd,
      marketCapSol,
      marketCapUsd: round4(marketCapSol * solPriceUsd),
      isComplete: currentPrice?.isComplete ?? false,
      realSolReserves: currentPrice?.realSolReserves ?? 0,
      launchCompletedAt: successfulLaunch?.completedAt ?? null,
    },
    metrics: {
      treasury,
      holdingsValue: {
        valueSol: holdingsValue,
        tokenCount: holdingsBreakdown.totalTokenHoldings,
      },
      pnl: {
        net: pnl,
        totalBuyVolume: volumes.ownedBuyVolume,
        totalSellVolume: volumes.ownedSellVolume,
        holdingsValue,
      },
      activity: {
        totalVolume: round4(
          volumes.marketBuyVolume + volumes.marketSellVolume
        ),
        buyVolume: volumes.marketBuyVolume,
        sellVolume: volumes.marketSellVolume,
        transactionCount: volumes.totalTxCount,
        runningVolumeBots: treasury.runningVolumeBots,
      },
    },
    holdingsBreakdown: {
      tokenTotalSupply: holdingsBreakdown.tokenTotalSupply,
      bondingCurveTokens: holdingsBreakdown.bondingCurveTokens,
      circulatingSupply: holdingsBreakdown.circulatingSupply,
      userTotalTokens: holdingsBreakdown.userTotalTokens,
      userOwnershipPercent: holdingsBreakdown.userOwnershipPercent,
      userWallets: holdingsBreakdown.userWallets,
      externalHolders: holdingsBreakdown.externalHolders,
    },
    operations,
    recentTransactions,
    priceHistory,
  };
}

export const dashboardService = {
  async getStats(input: GetDashboardStatsInput, userId: string) {
    const token = await prisma.token.findFirst({
      where: { publicKey: input.tokenPublicKey, userId },
      select: { publicKey: true },
    });

    if (!token) {
      throw new AppError("Token not found", 404);
    }

    const cacheKey = `${input.tokenPublicKey}:${userId}`;
    const cached = statsCache.get(cacheKey);
    if (cached && Date.now() - cached.cachedAt < STATS_CACHE_TTL_MS) {
      return cached.data;
    }

    const data = await buildStatsResponse(input.tokenPublicKey, userId);

    statsCache.set(cacheKey, { data, cachedAt: Date.now() } as CachedStats);
    if (statsCache.size > 50) {
      const oldestKey = statsCache.keys().next().value;
      if (oldestKey) statsCache.delete(oldestKey);
    }

    return data;
  },

  async getDeFiPools(input: GetDefiPoolsInput, userId: string) {
    const token = await prisma.token.findFirst({
      where: { publicKey: input.tokenPublicKey, userId },
      select: { publicKey: true },
    });

    if (!token) {
      throw new AppError("Token not found", 404);
    }

    const { SHYFT_API_KEY } = getEnv();
    if (!SHYFT_API_KEY) {
      return { pools: [] };
    }

    try {
      const pools = await shyftDefiService.getPoolsByToken(
        input.tokenPublicKey
      );
      return {
        pools: pools.map((pool) => ({
          address: pool.address,
          dex: pool.dex,
          tvlUsd: pool.tvl_usd,
          volume24hUsd: pool.volume_24h_usd,
          feeRate: pool.fee_rate,
          tokenA: {
            address: pool.token_a.address,
            symbol: pool.token_a.symbol,
            name: pool.token_a.name,
            reserve: pool.token_a.reserve,
            decimals: pool.token_a.decimals,
          },
          tokenB: {
            address: pool.token_b.address,
            symbol: pool.token_b.symbol,
            name: pool.token_b.name,
            reserve: pool.token_b.reserve,
            decimals: pool.token_b.decimals,
          },
          createdAt: pool.created_at,
        })),
      };
    } catch {
      return { pools: [] };
    }
  },
};
