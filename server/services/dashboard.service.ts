import "server-only";
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
import { testRunLogService } from "@/server/services/test-run-log.service";
import { getEnv } from "@/lib/config/env";
import { logger } from "@/lib/logger";
import { calculateLaunchUsageFees } from "@/lib/config/usage-fees.config";
import { settleUnsettledForToken } from "@/server/services/app-transaction-settler";
import type { AppTransactionType } from "@/lib/generated/prisma/client";

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

type UserHoldingRow = {
  id: string;
  walletPublicKey: string;
  tokenBalance: Prisma.Decimal;
  lastUpdated: Date;
  createdAt: Date;
  wallet: {
    publicKey: string;
    type: string;
    balanceSol: Prisma.Decimal;
  };
};

function dedupeUserHoldingsByWallet(holdings: UserHoldingRow[]) {
  const holdingsByWallet = new Map<string, UserHoldingRow[]>();

  for (const holding of holdings) {
    const existing = holdingsByWallet.get(holding.walletPublicKey) ?? [];
    existing.push(holding);
    holdingsByWallet.set(holding.walletPublicKey, existing);
  }

  return Array.from(holdingsByWallet.values())
    .map((walletHoldings) =>
      [...walletHoldings].sort((a, b) => {
        const lastUpdatedDiff =
          b.lastUpdated.getTime() - a.lastUpdated.getTime();
        if (lastUpdatedDiff !== 0) return lastUpdatedDiff;

        const createdAtDiff = b.createdAt.getTime() - a.createdAt.getTime();
        if (createdAtDiff !== 0) return createdAtDiff;

        return b.id.localeCompare(a.id);
      })[0]
    )
    .filter((holding): holding is UserHoldingRow => Boolean(holding));
}

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
          type: { in: ["BUNDLER", "VOLUME", "BUYER", "DISTRIBUTION"] },
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

async function getOperationalCosts(tokenPublicKey: string, userId: string) {
  // Trigger backstop sweep for any CONFIRMED row missing lamportsDelta. Bounded
  // and idempotent — keeps the dashboard authoritative even after RPC blips.
  await settleUnsettledForToken({ userId, tokenPublicKey, limit: 50 }).catch(
    () => {}
  );

  const confirmedWhere = { userId, tokenPublicKey, status: "CONFIRMED" as const };

  const [byTypeRows, feeBySourceRows, unsettledCount, launch] = await Promise.all(
    [
      prisma.appTransaction.groupBy({
        by: ["type"],
        where: {
          ...confirmedWhere,
          type: { not: "FEE_SUBSCRIPTION" },
          lamportsDelta: { not: null },
        },
        _sum: { lamportsDelta: true },
      }),
      prisma.appTransaction.groupBy({
        by: ["source"],
        where: {
          ...confirmedWhere,
          type: "FEE_USAGE",
          lamportsDelta: { not: null },
        },
        _sum: { lamportsDelta: true },
      }),
      prisma.appTransaction.count({
        where: { ...confirmedWhere, lamportsDelta: null },
      }),
      prisma.launch.findFirst({
        where: { tokenPublicKey, userId, status: "SUCCEEDED" },
        select: { id: true, input: true },
        orderBy: { createdAt: "desc" },
      }),
    ]
  );

  const sumByType = (t: AppTransactionType) =>
    Number(
      byTypeRows.find((r) => r.type === t)?._sum.lamportsDelta ?? BigInt(0)
    ) / 1_000_000_000;

  const feeBySource = (source: string) =>
    Number(
      feeBySourceRows.find((f) => f.source === source)?._sum.lamportsDelta ??
        BigInt(0)
    ) / 1_000_000_000;

  // Signed deltas: outflows < 0, inflows > 0.
  const tradeBuysDelta = round4(sumByType("TRADE_BUY"));
  const tradeSellsDelta = round4(sumByType("TRADE_SELL"));
  const tradeCreatesDelta = round4(sumByType("TRADE_CREATE"));
  const platformFeesDelta = round4(sumByType("FEE_USAGE"));
  const jitoTipsDelta = round4(sumByType("JITO_TIP"));
  const transfersDelta = round4(
    sumByType("TRANSFER_FUND") +
      sumByType("TRANSFER_RETURN") +
      sumByType("TRANSFER_RECLAIM") +
      sumByType("TRANSFER_WITHDRAW")
  );
  const ataOpsDelta = round4(
    sumByType("ACCOUNT_ATA_CREATE") + sumByType("ACCOUNT_ATA_CLOSE")
  );
  const tokenOpsDelta = round4(
    sumByType("TOKEN_DISTRIBUTE") + sumByType("TOKEN_CONSOLIDATE")
  );
  const rewardsClaimDelta = round4(sumByType("REWARD_CLAIM"));
  const rewardsPayoutDelta = round4(sumByType("REWARD_PAYOUT"));
  const creatorRewardsDelta = round4(rewardsClaimDelta + rewardsPayoutDelta);

  const launchFeesDelta = round4(feeBySource("LAUNCH"));
  const exitFeesDelta = round4(feeBySource("EXIT"));
  const volumeBotFeesDelta = round4(feeBySource("VOLUME_BOT"));
  const walletFeesDelta = round4(feeBySource("WALLET"));

  const launchInput = launch?.input as Record<string, unknown> | null;
  const launchFeeBreakdown = launchInput
    ? (() => {
        const fees = calculateLaunchUsageFees({
          devWalletOption: (launchInput.devWalletOption as "system" | "import" | "generate" | "use_main") ?? "generate",
          bundleBuyEnabled: Boolean(launchInput.bundleBuyEnabled),
          bundlerWalletCount: Number(launchInput.bundlerWalletCount ?? 0),
          distributionWalletMultiplier: Number(launchInput.distributionWalletMultiplier ?? 0),
          vanityMint: Boolean(launchInput.vanityMint),
          removeAttribution: Boolean(launchInput.removeAttribution),
        });
        return {
          generatedWalletFeeSol: fees.generatedWalletFeeSol,
          generatedWalletCount: fees.generatedWalletCount,
          generatedWalletsBilledForFeeCount:
            fees.generatedWalletsBilledForFeeCount,
          nonSystemDevWalletFeeSol: fees.nonSystemDevWalletFeeSol,
          vanityMintFeeSol: fees.vanityMintFeeSol,
          attributionRemovalFeeSol: fees.descriptionAttributionRemovalFeeSol,
          bundleBuyFeeSol: fees.bundleBuyFeeSol,
        };
      })()
    : null;

  return {
    tradeBuysDelta,
    tradeSellsDelta,
    tradeCreatesDelta,
    platformFeesDelta,
    jitoTipsDelta,
    transfersDelta,
    ataOpsDelta,
    tokenOpsDelta,
    creatorRewardsDelta,
    rewardsClaimDelta,
    rewardsPayoutDelta,
    launchFeesDelta,
    exitFeesDelta,
    volumeBotFeesDelta,
    walletFeesDelta,
    launchFeeBreakdown,
    unsettledRowCount: unsettledCount,
    isComplete: unsettledCount === 0,
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

  const [userHoldings, currentHolders] = await Promise.all([
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
          orderBy: [{ lastUpdated: "desc" }, { createdAt: "desc" }],
        })
      : Promise.resolve([]),
    holdersService.getCurrentHolders(tokenPublicKey),
  ]);
  const uniqueUserHoldings = dedupeUserHoldingsByWallet(userHoldings);
  const totalTokenHoldings = uniqueUserHoldings.reduce(
    (sum, holding) => sum + Number(holding.tokenBalance),
    0
  );
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

  const userWalletRows = uniqueUserHoldings
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

  const externalHolders = currentHolders
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
      slot: bigint | null;
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
        tt."slot",
        tt."blockTime",
        tt."createdAt"
      FROM "TokenTransaction" tt
      WHERE tt."tokenPublicKey" = ${tokenPublicKey}
        AND tt."transactionType" IN ('BUY', 'SELL')
      ORDER BY
        tt."transactionSignature",
        CASE WHEN tt."walletPublicKey" = ${bondingCurvePublicKey} THEN 1 ELSE 0 END ASC,
        CASE WHEN tt."walletType" IS NULL THEN 1 ELSE 0 END ASC,
        tt."slot" DESC NULLS LAST,
        COALESCE(tt."blockTime", tt."createdAt") DESC
    ) grouped
    ORDER BY grouped."slot" DESC NULLS LAST, COALESCE(grouped."blockTime", grouped."createdAt") DESC
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
    orderBy: [{ slot: { sort: "asc", nulls: "first" } }, { blockTime: "asc" }, { createdAt: "asc" }],
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

  const defaultCosts = {
    tradeBuysDelta: 0,
    tradeSellsDelta: 0,
    tradeCreatesDelta: 0,
    platformFeesDelta: 0,
    jitoTipsDelta: 0,
    transfersDelta: 0,
    ataOpsDelta: 0,
    tokenOpsDelta: 0,
    creatorRewardsDelta: 0,
    rewardsClaimDelta: 0,
    rewardsPayoutDelta: 0,
    launchFeesDelta: 0,
    exitFeesDelta: 0,
    volumeBotFeesDelta: 0,
    walletFeesDelta: 0,
    launchFeeBreakdown: null as {
      generatedWalletFeeSol: number;
      generatedWalletCount: number;
      generatedWalletsBilledForFeeCount: number;
      nonSystemDevWalletFeeSol: number;
      vanityMintFeeSol: number;
      attributionRemovalFeeSol: number;
      bundleBuyFeeSol: number;
    } | null,
    unsettledRowCount: 0,
    isComplete: true,
  };

  const results = await Promise.allSettled([
    getOperationalCosts(tokenPublicKey, userId),
    getVolumeMetrics(tokenPublicKey),
    getHoldingsBreakdown(tokenPublicKey, userWalletPubkeys, priceSol, circulatingSupply, currentPrice),
    getOperations(tokenPublicKey, userId),
    getRecentTransactions(tokenPublicKey),
    isComplete ? Promise.resolve([]) : getPriceHistory(tokenPublicKey),
  ]);

  const costs = results[0].status === "fulfilled" ? results[0].value : defaultCosts;
  const volumes = results[1].status === "fulfilled" ? results[1].value : defaultVolumes;
  const holdingsBreakdown = results[2].status === "fulfilled" ? results[2].value : defaultHoldings;
  const operations = results[3].status === "fulfilled" ? results[3].value : { botSessions: [] };
  const recentTransactions = results[4].status === "fulfilled" ? results[4].value : [];
  const priceHistory = results[5].status === "fulfilled" ? results[5].value : [];
  const failedSubQueries: string[] = [];

  for (const [i, r] of results.entries()) {
    if (r.status === "rejected") {
      const names = ["costs", "volumes", "holdings", "operations", "transactions", "priceHistory"];
      failedSubQueries.push(names[i] ?? `unknown-${i}`);
      log.error(`Dashboard sub-query failed: ${names[i]}`, {
        tokenPublicKey,
        error: r.reason instanceof Error ? r.reason.message : r.reason,
      });
    }
  }

  const holdingsValue = holdingsBreakdown.holdingsValueSol;
  // Net P&L is the sum of every signed wallet delta we tracked for the token.
  const pnl = round4(
    costs.tradeBuysDelta +
      costs.tradeSellsDelta +
      costs.tradeCreatesDelta +
      costs.platformFeesDelta +
      costs.jitoTipsDelta +
      costs.transfersDelta +
      costs.ataOpsDelta +
      costs.tokenOpsDelta +
      costs.creatorRewardsDelta
  );

  const marketCapSol = round4(priceSol * tokenTotalSupply);

  await testRunLogService.appendServerEvent({
    eventType: "dashboard_query_result",
    source: "dashboard.service",
    tokenPublicKey,
    action: "buildStatsResponse",
    userId,
    cache: { status: "miss" },
    summary: {
      failedSubQueries,
      priceSol,
      marketCapSol,
      activityTransactions: volumes.totalTxCount,
      ownedWalletCount: holdingsBreakdown.userWallets.length,
      recentTransactionCount: recentTransactions.length,
    },
  });

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
      holdingsValue: {
        valueSol: holdingsValue,
        tokenCount: holdingsBreakdown.totalTokenHoldings,
      },
      pnl: {
        net: pnl,
        tokenBuys: costs.tradeBuysDelta,
        tokenSells: costs.tradeSellsDelta,
        tokenCreates: costs.tradeCreatesDelta,
        platformFees: costs.platformFeesDelta,
        launchFees: costs.launchFeesDelta,
        exitFees: costs.exitFeesDelta,
        volumeBotFees: costs.volumeBotFeesDelta,
        walletFees: costs.walletFeesDelta,
        launchFeeBreakdown: costs.launchFeeBreakdown,
        jitoTips: costs.jitoTipsDelta,
        transfers: costs.transfersDelta,
        ataOps: costs.ataOpsDelta,
        tokenOps: costs.tokenOpsDelta,
        creatorRewards: costs.creatorRewardsDelta,
        rewardsClaim: costs.rewardsClaimDelta,
        rewardsPayout: costs.rewardsPayoutDelta,
        unsettledRowCount: costs.unsettledRowCount,
        isComplete: costs.isComplete,
      },
      activity: {
        totalVolume: round4(
          volumes.marketBuyVolume + volumes.marketSellVolume
        ),
        buyVolume: volumes.marketBuyVolume,
        sellVolume: volumes.marketSellVolume,
        transactionCount: volumes.totalTxCount,
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
      await testRunLogService.appendServerEvent({
        eventType: "dashboard_query_result",
        source: "dashboard.service",
        tokenPublicKey: input.tokenPublicKey,
        action: "getStats",
        userId,
        cache: {
          status: "hit",
          ageMs: Date.now() - cached.cachedAt,
        },
        summary: {
          priceSol: cached.data.header.priceSol,
          marketCapSol: cached.data.header.marketCapSol,
          transactionCount: cached.data.metrics.activity.transactionCount,
          walletCount: cached.data.holdingsBreakdown.userWallets.length,
        },
      });
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
