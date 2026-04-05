type DashboardStatsLike = {
  header: {
    priceSol: number;
    marketCapSol: number;
    marketCapUsd: number;
    isComplete: boolean;
    launchCompletedAt: Date | string | null;
  };
  metrics: {
    holdingsValue: {
      valueSol: number;
      tokenCount: number;
    };
    pnl: {
      net: number;
      totalBuyVolume: number;
      totalSellVolume: number;
      platformFees: number;
      launchFees: number;
      launchFeeBreakdown: {
        generatedWalletFeeSol: number;
        generatedWalletCount: number;
        vanityMintFeeSol: number;
        attributionRemovalFeeSol: number;
        bundleBuyFeeSol: number;
      } | null;
      exitFees: number;
      volumeBotFees: number;
      jitoTipsSol: number;
      totalFees: number;
      creationCostSol: number;
    };
    activity: {
      totalVolume: number;
      buyVolume: number;
      sellVolume: number;
      transactionCount: number;
    };
  };
  holdingsBreakdown: {
    tokenTotalSupply: number;
    circulatingSupply: number;
    userTotalTokens: number;
    userOwnershipPercent: number;
    userWallets: Array<{ publicKey: string; tokenBalance: number }>;
    externalHolders: unknown[];
  };
  operations: {
    botSessions: unknown[];
  };
  recentTransactions: unknown[];
  priceHistory: unknown[];
};

type DashboardDefiLike = {
  pools: unknown[];
} | null | undefined;

export function buildDashboardSummaryPayload(input: {
  tokenPublicKey: string;
  statsData: DashboardStatsLike;
  monitoringHealthState: string;
  isMonitoring: boolean;
  trigger: string;
  dataUpdatedAt: number;
  defiData?: DashboardDefiLike;
}) {
  const { statsData, defiData } = input;
  return {
    tokenPublicKey: input.tokenPublicKey,
    trigger: input.trigger,
    monitoringHealthState: input.monitoringHealthState,
    isMonitoring: input.isMonitoring,
    dataUpdatedAt: input.dataUpdatedAt,
    header: {
      priceSol: statsData.header.priceSol,
      marketCapSol: statsData.header.marketCapSol,
      marketCapUsd: statsData.header.marketCapUsd,
      isComplete: statsData.header.isComplete,
      launchCompletedAt: statsData.header.launchCompletedAt,
    },
    activity: statsData.metrics.activity,
    holdingsValue: statsData.metrics.holdingsValue,
    pnl: statsData.metrics.pnl,
    holdings: {
      userTotalTokens: statsData.holdingsBreakdown.userTotalTokens,
      userOwnershipPercent: statsData.holdingsBreakdown.userOwnershipPercent,
      walletCount: statsData.holdingsBreakdown.userWallets.length,
      walletsWithBalance: statsData.holdingsBreakdown.userWallets.filter(
        (wallet) => Number(wallet.tokenBalance) > 0
      ).length,
      externalHolderCount: statsData.holdingsBreakdown.externalHolders.length,
      circulatingSupply: statsData.holdingsBreakdown.circulatingSupply,
    },
    operations: {
      botSessionCount: statsData.operations.botSessions.length,
    },
    recentTransactionCount: statsData.recentTransactions.length,
    priceHistoryPointCount: statsData.priceHistory.length,
    defiPoolCount: defiData?.pools.length ?? 0,
  };
}

export function buildDashboardFullSnapshotPayload(input: {
  statsData: DashboardStatsLike;
  defiData?: DashboardDefiLike;
  monitoringHealthState: string;
  isMonitoring: boolean;
}) {
  return {
    monitoring: {
      healthState: input.monitoringHealthState,
      isMonitoring: input.isMonitoring,
    },
    header: input.statsData.header,
    metrics: input.statsData.metrics,
    holdingsBreakdown: input.statsData.holdingsBreakdown,
    operations: input.statsData.operations,
    recentTransactions: input.statsData.recentTransactions,
    priceHistory: input.statsData.priceHistory,
    defiPools: input.defiData?.pools ?? [],
  };
}
