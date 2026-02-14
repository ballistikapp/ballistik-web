#!/usr/bin/env tsx

import * as dotenv from "dotenv";
import { join } from "path";
import { PrismaClient } from "../lib/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

dotenv.config({
  path: join(process.cwd(), ".env.development.local"),
  quiet: true,
});

const connectionString =
  process.env.PROD_STORAGE_POSTGRES_URL || process.env.DEV_STORAGE_POSTGRES_URL;

if (!connectionString) {
  console.error(
    "Error: Database connection string not found. Please set PROD_STORAGE_POSTGRES_URL or DEV_STORAGE_POSTGRES_URL in .env.development.local"
  );
  process.exit(1);
}

const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter, log: ["error"] });

async function analyzeRecentSession() {
  console.log("Fetching most recent volume bot session...\n");

  const session = await prisma.volumeBotSession.findFirst({
    orderBy: { createdAt: "desc" },
    include: {
      wallets: {
        include: {
          wallet: true,
        },
        orderBy: { tradesExecuted: "desc" },
      },
      logs: {
        orderBy: { createdAt: "desc" },
        take: 500,
      },
      token: true,
      user: true,
    },
  });

  if (!session) {
    console.log("No volume bot sessions found.");
    return;
  }

  console.log("=".repeat(80));
  console.log("SESSION OVERVIEW");
  console.log("=".repeat(80));
  console.log(`Session ID: ${session.id}`);
  console.log(`Status: ${session.status}`);
  console.log(
    `Token: ${session.token?.symbol || "N/A"} (${session.tokenPublicKey})`
  );
  console.log(`User: ${session.user?.name || session.userId}`);
  console.log(`Created: ${session.createdAt}`);
  console.log(`Started: ${session.startedAt || "Not started"}`);
  console.log(`Stopped: ${session.stoppedAt || "Not stopped"}`);
  console.log(`Last Tick: ${session.lastTickAt || "No ticks"}`);
  console.log("");

  console.log("=".repeat(80));
  console.log("SESSION STATS");
  console.log("=".repeat(80));
  console.log(`Total Volume (USD): $${session.totalVolumeUsd}`);
  console.log(`Total Trades: ${session.totalTrades}`);
  console.log(`Total PnL (SOL): ${session.totalPnlSol}`);
  console.log(`Runtime (seconds): ${session.runtimeSeconds}`);
  console.log(`Runtime (minutes): ${(session.runtimeSeconds / 60).toFixed(2)}`);
  console.log("");

  console.log("=".repeat(80));
  console.log("CONFIG");
  console.log("=".repeat(80));
  console.log(JSON.stringify(session.config, null, 2));
  console.log("");

  console.log("=".repeat(80));
  console.log(`WALLETS (${session.wallets.length} total)`);
  console.log("=".repeat(80));

  const activeWallets = session.wallets.filter((w) => w.status === "ACTIVE");
  const pausedWallets = session.wallets.filter((w) => w.status === "PAUSED");
  const reclaimedWallets = session.wallets.filter(
    (w) => w.status === "RECLAIMED"
  );
  const failedWallets = session.wallets.filter((w) => w.status === "FAILED");

  console.log(
    `Active: ${activeWallets.length}, Paused: ${pausedWallets.length}, Reclaimed: ${reclaimedWallets.length}, Failed: ${failedWallets.length}`
  );
  console.log("");

  for (const w of session.wallets) {
    const shortKey = w.walletPublicKey.slice(0, 8);
    console.log(
      `[${shortKey}...] Status: ${w.status.padEnd(10)} | Trades: ${String(w.tradesExecuted).padStart(3)} | SOL: ${Number(w.solBalance).toFixed(4).padStart(10)} | Tokens: ${Number(w.tokenBalance).toFixed(2).padStart(12)} | PnL: ${Number(w.pnlSol).toFixed(6).padStart(12)} SOL`
    );
    if (w.pauseReason) {
      console.log(`         Pause reason: ${w.pauseReason}`);
    }
    if (w.lastTradeAt) {
      console.log(`         Last trade: ${w.lastTradeAt}`);
    }
  }
  console.log("");

  console.log("=".repeat(80));
  console.log(`LOGS (last ${session.logs.length} entries, newest first)`);
  console.log("=".repeat(80));

  const logsByLevel = {
    INFO: 0,
    WARN: 0,
    ERROR: 0,
    TRADE: 0,
  };

  const tradesBySide: { buy: number; sell: number } = { buy: 0, sell: 0 };

  for (const log of session.logs) {
    logsByLevel[log.level as keyof typeof logsByLevel]++;
    if (log.level === "TRADE" && log.data) {
      const data = log.data as Record<string, unknown>;
      if (data.side === "buy") tradesBySide.buy++;
      if (data.side === "sell") tradesBySide.sell++;
    }
  }

  console.log(
    `Log levels: INFO=${logsByLevel.INFO}, WARN=${logsByLevel.WARN}, ERROR=${logsByLevel.ERROR}, TRADE=${logsByLevel.TRADE}`
  );
  console.log(
    `Trades in logs: Buys=${tradesBySide.buy}, Sells=${tradesBySide.sell}`
  );
  console.log("");

  console.log("--- Recent Logs ---");
  for (const log of session.logs.slice(0, 30)) {
    const time = log.createdAt.toISOString().slice(11, 19);
    const wallet = log.walletPublicKey
      ? `[${log.walletPublicKey.slice(0, 8)}]`
      : "[session]";
    console.log(
      `${time} ${log.level.padEnd(5)} ${wallet} ${log.type}: ${log.message}`
    );
    if (log.data && log.level !== "INFO") {
      console.log(`         Data: ${JSON.stringify(log.data)}`);
    }
  }
  console.log("");

  // Error analysis
  const errorLogs = session.logs.filter((l) => l.level === "ERROR");
  if (errorLogs.length > 0) {
    console.log("=".repeat(80));
    console.log(`ERROR ANALYSIS (${errorLogs.length} errors)`);
    console.log("=".repeat(80));

    const errorTypes: Record<string, number> = {};
    for (const err of errorLogs) {
      const msg = err.message.slice(0, 50);
      errorTypes[msg] = (errorTypes[msg] || 0) + 1;
    }

    for (const [msg, count] of Object.entries(errorTypes).sort(
      (a, b) => b[1] - a[1]
    )) {
      console.log(`  (${count}x) ${msg}`);
    }
    console.log("");
  }

  // Trade analysis
  const tradeLogs = session.logs.filter((l) => l.level === "TRADE");
  if (tradeLogs.length > 0) {
    console.log("=".repeat(80));
    console.log(`TRADE ANALYSIS (${tradeLogs.length} trades in logs)`);
    console.log("=".repeat(80));

    let totalBuySol = 0;
    let totalSellSol = 0;
    let buyCount = 0;
    let sellCount = 0;

    for (const trade of tradeLogs) {
      const data = trade.data as Record<string, unknown> | null;
      const isBuy = trade.type === "buy";
      const isSell = trade.type === "sell";

      if (data) {
        const solAmount = Number(data.tradeAmountSol || data.solAmount || 0);
        const netChange = Number(data.netSolChangeSol || 0);

        if (isBuy) {
          totalBuySol += solAmount;
          buyCount++;
        }
        if (isSell) {
          totalSellSol += solAmount;
          sellCount++;
        }
      }
    }

    console.log(
      `Buy trades: ${buyCount} totaling ${totalBuySol.toFixed(4)} SOL`
    );
    console.log(
      `Sell trades: ${sellCount} totaling ${totalSellSol.toFixed(4)} SOL`
    );
    console.log(
      `Net SOL spent: ${(totalBuySol - totalSellSol).toFixed(4)} SOL`
    );
    console.log(
      `Buy/Sell ratio: ${buyCount}:${sellCount} (${((buyCount / (buyCount + sellCount)) * 100).toFixed(0)}% buys)`
    );
    console.log("");

    // Detailed trade breakdown by wallet
    console.log("--- Trade breakdown by wallet ---");
    const walletTrades: Record<
      string,
      { buys: number; sells: number; buyVol: number; sellVol: number }
    > = {};

    for (const trade of tradeLogs) {
      const data = trade.data as Record<string, unknown> | null;
      const wallet = trade.walletPublicKey?.slice(0, 8) || "unknown";
      const isBuy = trade.type === "buy";
      const solAmount = Number(data?.tradeAmountSol || data?.solAmount || 0);

      if (!walletTrades[wallet]) {
        walletTrades[wallet] = { buys: 0, sells: 0, buyVol: 0, sellVol: 0 };
      }

      if (isBuy) {
        walletTrades[wallet].buys++;
        walletTrades[wallet].buyVol += solAmount;
      } else {
        walletTrades[wallet].sells++;
        walletTrades[wallet].sellVol += solAmount;
      }
    }

    for (const [wallet, stats] of Object.entries(walletTrades)) {
      console.log(
        `  [${wallet}] Buys: ${stats.buys} (${stats.buyVol.toFixed(4)} SOL) | Sells: ${stats.sells} (${stats.sellVol.toFixed(4)} SOL)`
      );
    }
    console.log("");

    // Range distribution analysis
    const config = session.config as {
      ranges: Array<{
        solMin: number;
        solMax: number;
        direction: string;
        buyProbability?: number;
      }>;
    } | null;
    if (config?.ranges) {
      console.log("--- Range distribution analysis ---");
      console.log("Configured ranges:");
      for (let i = 0; i < config.ranges.length; i++) {
        const r = config.ranges[i];
        console.log(
          `  Range ${i + 1}: ${r.solMin}-${r.solMax} SOL, ${r.direction}${r.buyProbability !== undefined ? `, buyProb=${r.buyProbability}` : ""}`
        );
      }

      // Categorize trades by range
      const tradesByRange: number[] = config.ranges.map(() => 0);
      for (const trade of tradeLogs) {
        const data = trade.data as Record<string, unknown> | null;
        const solAmount = Number(data?.tradeAmountSol || 0);

        // Find which range this trade belongs to
        for (let i = 0; i < config.ranges.length; i++) {
          const r = config.ranges[i];
          if (solAmount >= r.solMin * 0.99 && solAmount <= r.solMax * 1.01) {
            tradesByRange[i]++;
            break;
          }
        }
      }

      console.log("\nActual distribution:");
      const totalTrades = tradeLogs.length;
      for (let i = 0; i < config.ranges.length; i++) {
        const count = tradesByRange[i];
        const actualPct = totalTrades > 0 ? (count / totalTrades) * 100 : 0;
        console.log(
          `  Range ${i + 1}: ${count}/${totalTrades} trades (${actualPct.toFixed(1)}%)`
        );
      }

      // Direction analysis for "both" ranges
      console.log("\nDirection distribution:");
      console.log(
        `  Overall: ${buyCount} buys / ${sellCount} sells (${((buyCount / totalTrades) * 100).toFixed(1)}% buys)`
      );

      // For range 2 (both direction), check buy probability
      const range2Trades = tradeLogs.filter((t) => {
        const data = t.data as Record<string, unknown> | null;
        const solAmount = Number(data?.tradeAmountSol || 0);
        const r = config.ranges[1]; // second range is "both"
        return (
          r && solAmount >= r.solMin * 0.99 && solAmount <= r.solMax * 1.01
        );
      });

      if (range2Trades.length > 0 && config.ranges[1]?.direction === "both") {
        const r2Buys = range2Trades.filter((t) => t.type === "buy").length;
        const r2Sells = range2Trades.filter((t) => t.type === "sell").length;
        const expectedBuyProb = config.ranges[1].buyProbability || 0.5;
        const actualBuyProb = r2Buys / range2Trades.length;
        console.log(
          `  Range 2 (both): ${r2Buys} buys / ${r2Sells} sells (${(actualBuyProb * 100).toFixed(1)}% buys) - expected ${(expectedBuyProb * 100).toFixed(1)}%`
        );
      }
      console.log("");
    }
  }

  // Performance metrics
  if (session.startedAt && session.totalTrades > 0) {
    console.log("=".repeat(80));
    console.log("PERFORMANCE METRICS");
    console.log("=".repeat(80));

    const runtimeMinutes = session.runtimeSeconds / 60;
    const tradesPerMinute = session.totalTrades / runtimeMinutes;
    const avgTradeSize = session.totalVolumeUsd
      ? Number(session.totalVolumeUsd) / session.totalTrades
      : 0;

    console.log(`Trades per minute: ${tradesPerMinute.toFixed(2)}`);
    console.log(`Avg trade size (USD): $${avgTradeSize.toFixed(2)}`);

    const activeWalletCount = session.wallets.filter(
      (w) => w.tradesExecuted > 0
    ).length;
    const avgTradesPerWallet = session.totalTrades / activeWalletCount;
    console.log(`Active trading wallets: ${activeWalletCount}`);
    console.log(`Avg trades per wallet: ${avgTradesPerWallet.toFixed(1)}`);
    console.log("");
  }

  await prisma.$disconnect();
  await pool.end();
}

analyzeRecentSession().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  await pool.end();
  process.exit(1);
});
