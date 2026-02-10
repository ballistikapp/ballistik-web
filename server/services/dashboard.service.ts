import { PublicKey } from "@solana/web3.js";
import { prisma, Prisma } from "@/lib/prisma";
import { AppError } from "@/server/errors";
import type {
  GetDashboardStatsInput,
  GetDefiPoolsInput,
} from "@/server/schemas/dashboard.schema";
import { priceService } from "@/server/services/price.service";
import { holdersService } from "@/server/services/holders.service";
import { derivePumpAddresses } from "@/server/solana/pump-new-idl";
import { shyftDefiService } from "@/server/services/shyft-defi.service";
import { getEnv } from "@/lib/config/env";

export const dashboardService = {
  async getStats(input: GetDashboardStatsInput, userId: string) {
    const token = await prisma.token.findFirst({
      where: { publicKey: input.tokenPublicKey, userId },
      select: { publicKey: true },
    });

    if (!token) {
      throw new AppError("Token not found", 404);
    }

    const tokenPublicKey = input.tokenPublicKey;

    const [
      walletAgg,
      devWalletAgg,
      holdingAgg,
      transactionCount,
      recentTransactions,
      runningVolumeBots,
      volumeBotSessions,
      transactionHistory,
      currentPrice,
      userHoldings,
      topHolders,
    ] = await Promise.all([
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

      prisma.holding.aggregate({
        where: { tokenPublicKey },
        _sum: {
          tokenBalance: true,
          totalBuyAmount: true,
          totalSellAmount: true,
        },
        _count: { id: true },
      }),

      prisma.transaction.count({
        where: { tokenPublicKey },
      }),

      prisma.transaction.findMany({
        where: { tokenPublicKey },
        include: {
          wallet: { select: { publicKey: true, type: true } },
        },
        orderBy: { createdAt: "desc" },
        take: 15,
      }),

      prisma.volumeBotSession.count({
        where: { tokenPublicKey, userId, status: "RUNNING" },
      }),

      prisma.volumeBotSession.findMany({
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
      }),

      prisma.transaction.findMany({
        where: { tokenPublicKey },
        select: {
          transactionType: true,
          solAmount: true,
          tokenAmount: true,
          createdAt: true,
        },
        orderBy: { createdAt: "asc" },
      }),

      priceService.getCurrentPrice(tokenPublicKey),

      prisma.holding.findMany({
        where: { tokenPublicKey },
        include: {
          wallet: {
            select: { publicKey: true, type: true, balanceSol: true },
          },
        },
      }),

      holdersService.getTopHolders(tokenPublicKey),
    ]);

    const operationalSol = Number(walletAgg._sum.balanceSol ?? 0);
    const devSol = devWalletAgg[0]
      ? Number(devWalletAgg[0].sum ?? 0)
      : 0;
    const operationalCount = walletAgg._count.publicKey;
    const devCount = devWalletAgg[0] ? Number(devWalletAgg[0].count) : 0;

    const round4 = (n: number) => Math.round(n * 10000) / 10000;

    const totalBuyVolume = round4(Number(holdingAgg._sum.totalBuyAmount ?? 0));
    const totalSellVolume = round4(Number(holdingAgg._sum.totalSellAmount ?? 0));
    const totalTokenHoldings = Number(holdingAgg._sum.tokenBalance ?? 0);
    const priceSol = currentPrice?.priceSol ?? 0;
    const holdingsValue = round4(totalTokenHoldings * priceSol);
    const pnl = round4(totalSellVolume + holdingsValue - totalBuyVolume);

    // Aggregate transactions into 5-minute OHLC candles
    const CANDLE_INTERVAL = 5 * 60; // 5 minutes in seconds
    const candleMap = new Map<number, { open: number; high: number; low: number; close: number; lastTime: number }>();
    
    for (const tx of transactionHistory) {
      const solAmt = Number(tx.solAmount);
      const tokenAmt = Number(tx.tokenAmount);
      if (
        tokenAmt > 0 &&
        solAmt > 0 &&
        (tx.transactionType === "BUY" || tx.transactionType === "SELL")
      ) {
        const price = solAmt / tokenAmt;
        const timestamp = Math.floor(tx.createdAt.getTime() / 1000);
        const bucketTime = Math.floor(timestamp / CANDLE_INTERVAL) * CANDLE_INTERVAL;
        
        const existing = candleMap.get(bucketTime);
        if (!existing) {
          candleMap.set(bucketTime, {
            open: price,
            high: price,
            low: price,
            close: price,
            lastTime: timestamp,
          });
        } else {
          existing.high = Math.max(existing.high, price);
          existing.low = Math.min(existing.low, price);
          if (timestamp > existing.lastTime) {
            existing.close = price;
            existing.lastTime = timestamp;
          }
        }
      }
    }

    const priceHistory = Array.from(candleMap.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([time, candle]) => ({
        time,
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
      }));

    const tokenTotalSupply = currentPrice?.tokenTotalSupply ?? 0;
    const bondingCurveTokens = currentPrice?.realTokenReserves ?? 0;
    const circulatingSupply = tokenTotalSupply - bondingCurveTokens;

    const userWalletPubkeys = new Set(
      userHoldings.map((h) => h.wallet.publicKey)
    );

    let bondingCurvePda: string | null = null;
    try {
      const mint = new PublicKey(tokenPublicKey);
      const { bondingCurve } = derivePumpAddresses(mint);
      bondingCurvePda = bondingCurve.toBase58();
    } catch {
      // ignore derivation failure
    }

    const excludedAddresses = new Set<string>();
    if (bondingCurvePda) excludedAddresses.add(bondingCurvePda);
    for (const pk of userWalletPubkeys) excludedAddresses.add(pk);

    const userWalletRows = userHoldings
      .map((h) => {
        const tokenBalance = Number(h.tokenBalance);
        const avgBuyPrice = Number(h.averageBuyPrice);
        const holdingPercent =
          circulatingSupply > 0
            ? round4((tokenBalance / circulatingSupply) * 100)
            : 0;
        const valueSol = round4(tokenBalance * priceSol);
        const unrealizedPnl = round4(
          tokenBalance * priceSol - tokenBalance * avgBuyPrice
        );
        return {
          publicKey: h.wallet.publicKey,
          type: h.wallet.type,
          tokenBalance,
          holdingPercent,
          valueSol,
          avgBuyPrice,
          currentPrice: priceSol,
          unrealizedPnl,
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
      header: {
        priceSol,
        marketCapSol: round4(priceSol * tokenTotalSupply),
        isComplete: currentPrice?.isComplete ?? false,
        realSolReserves: currentPrice?.realSolReserves ?? 0,
      },
      metrics: {
        treasury: {
          totalSol: round4(operationalSol + devSol),
          operationalSol: round4(operationalSol),
          devSol: round4(devSol),
          walletCount: operationalCount + devCount,
          runningVolumeBots,
        },
        holdingsValue: {
          valueSol: holdingsValue,
          tokenCount: totalTokenHoldings,
        },
        pnl: {
          net: pnl,
          totalBuyVolume,
          totalSellVolume,
          holdingsValue,
        },
        activity: {
          totalVolume: round4(totalBuyVolume + totalSellVolume),
          buyVolume: totalBuyVolume,
          sellVolume: totalSellVolume,
          transactionCount,
          runningVolumeBots,
        },
      },
      holdingsBreakdown: {
        tokenTotalSupply,
        bondingCurveTokens,
        circulatingSupply,
        userTotalTokens,
        userOwnershipPercent,
        userWallets: userWalletRows,
        externalHolders,
      },
      operations: {
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
      },
      recentTransactions,
      priceHistory,
    };
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
      const pools = await shyftDefiService.getPoolsByToken(input.tokenPublicKey);
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
