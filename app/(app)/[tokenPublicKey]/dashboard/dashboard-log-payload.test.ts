import assert from "node:assert/strict";
import test from "node:test";
import {
  buildDashboardFullSnapshotPayload,
  buildDashboardSummaryPayload,
} from "./dashboard-log-payload";

const statsData = {
  header: {
    priceSol: 0.1234,
    marketCapSol: 1234,
    marketCapUsd: 2468,
    isComplete: false,
    launchCompletedAt: "2026-03-20T09:00:00.000Z",
  },
  metrics: {
    holdingsValue: {
      valueSol: 22,
      tokenCount: 1000,
    },
    pnl: {
      net: -3,
      tokenBuys: -12,
      tokenSells: 9,
      tokenCreates: 0,
      platformFees: -0.12,
      launchFees: -0.12,
      launchFeeBreakdown: {
        generatedWalletFeeSol: 0.12,
        generatedWalletCount: 11,
        generatedWalletsBilledForFeeCount: 10,
        nonSystemDevWalletFeeSol: 0,
        vanityMintFeeSol: 0,
        attributionRemovalFeeSol: 0,
        bundleBuyFeeSol: 0,
      },
      exitFees: 0,
      volumeBotFees: 0,
      walletFees: 0,
      jitoTips: -0.001,
      transfers: -0.005,
      ataOps: 0,
      tokenOps: 0,
      creatorRewards: 0,
      rewardsClaim: 0,
      rewardsPayout: 0,
      unsettledRowCount: 0,
      isComplete: true,
    },
    activity: {
      totalVolume: 99,
      buyVolume: 50,
      sellVolume: 49,
      transactionCount: 11,
    },
  },
  holdingsBreakdown: {
    tokenTotalSupply: 1_000_000,
    circulatingSupply: 800_000,
    userTotalTokens: 1000,
    userOwnershipPercent: 0.125,
    userWallets: [
      { publicKey: "wallet-1", tokenBalance: 1000 },
      { publicKey: "wallet-2", tokenBalance: 0 },
    ],
    externalHolders: [{ publicKey: "external-1" }],
  },
  operations: {
    botSessions: [{ id: "session-1" }],
  },
  recentTransactions: [{ signature: "sig-1" }, { signature: "sig-2" }],
  priceHistory: [{ time: 1, price: 1.2 }],
};

test("builds a compact dashboard summary payload", () => {
  const payload = buildDashboardSummaryPayload({
    tokenPublicKey: "token-123",
    statsData,
    monitoringHealthState: "healthy",
    isMonitoring: true,
    trigger: "poll",
    dataUpdatedAt: 123456,
    defiData: { pools: [{ id: "pool-1" }] },
  });

  assert.equal(payload.tokenPublicKey, "token-123");
  assert.equal(payload.activity.transactionCount, 11);
  assert.equal(payload.holdings.walletCount, 2);
  assert.equal(payload.holdings.walletsWithBalance, 1);
  assert.equal(payload.defiPoolCount, 1);
});

test("builds a full dashboard snapshot payload", () => {
  const payload = buildDashboardFullSnapshotPayload({
    statsData,
    monitoringHealthState: "degraded",
    isMonitoring: false,
    defiData: { pools: [{ id: "pool-1" }, { id: "pool-2" }] },
  });

  assert.equal(payload.monitoring.healthState, "degraded");
  assert.equal(payload.metrics.activity.totalVolume, 99);
  assert.equal(payload.recentTransactions.length, 2);
  assert.equal(payload.defiPools.length, 2);
});
