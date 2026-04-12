/**
 * Temporary marketing screenshot data. Safe to delete after asset capture.
 * Numbers are internally consistent with dashboard.service cap math:
 * marketCapSol = priceSol * tokenTotalSupply, marketCapUsd = marketCapSol * solPriceUsd.
 */

const round4 = (n: number) => Math.round(n * 10000) / 10000;

/** Per-token prices in SOL are tiny; round4 (4 fractional digits) collapses them to 0 */
const roundPriceSol = (n: number) => Math.round(n * 1e12) / 1e12;

export const MARKETING_MOCK_TOKEN_PUBLIC_KEY =
  "9pTgtohure7o9mUKUVZ8HaU5FRH8ZhUV3xvpBaE7pump" as const;

const TARGET_MARKET_CAP_USD = 5_400_000;
const ASSUMED_SOL_USD = 150;
/** Pump.fun-style total supply for market-cap math only */
const TOKEN_TOTAL_SUPPLY = 1e9;

const marketCapSol = round4(TARGET_MARKET_CAP_USD / ASSUMED_SOL_USD);
const priceSol = roundPriceSol(marketCapSol / TOKEN_TOTAL_SUPPLY);
const marketCapUsd = round4(marketCapSol * ASSUMED_SOL_USD);

const USER_TOKEN_HOLDINGS = 55_000_000;
const holdingsValueSol = round4(USER_TOKEN_HOLDINGS * priceSol);

/** Market activity (not user-owned): large volumes for a successful token */
const activityBuyVolume = 9200;
const activitySellVolume = 9200;
const activityTransactionCount = 24_320;

/** User P&L components — net = sell + rewards - buy - fees - creation */
const pnlTotalBuyVolume = 850;
const pnlTotalSellVolume = 3200;
const pnlCreatorRewardsClaimedSol = 180;
const pnlPlatformFees = 12;
const pnlLaunchFees = 18;
const pnlExitFees = 4;
const pnlVolumeBotFees = 8;
const pnlJitoTipsSol = 3;
const pnlTotalFees = round4(
  pnlPlatformFees +
    pnlLaunchFees +
    pnlExitFees +
    pnlVolumeBotFees +
    pnlJitoTipsSol
);
const pnlCreationCostSol = 12;
const pnlNet = round4(
  pnlTotalSellVolume +
    pnlCreatorRewardsClaimedSol -
    pnlTotalBuyVolume -
    pnlTotalFees -
    pnlCreationCostSol
);

function buildPriceHistory(
  pointCount: number,
  startFraction: number
): Array<{ time: number; price: number }> {
  const now = Math.floor(Date.now() / 1000);
  const span = 3 * 24 * 60 * 60; // spread over3 days of chart time
  const startPrice = roundPriceSol(priceSol * startFraction);
  const points: Array<{ time: number; price: number }> = [];
  for (let i = 0; i < pointCount; i++) {
    const t = i / Math.max(1, pointCount - 1);
    // Ease-out curve toward current price
    const eased = 1 - (1 - t) ** 2;
    const p = roundPriceSol(startPrice + (priceSol - startPrice) * eased);
    points.push({
      time: now - span + Math.floor((span * i) / Math.max(1, pointCount - 1)),
      price: p,
    });
  }
  return points;
}

export const marketingMockDashboard = {
  tokenPublicKey: MARKETING_MOCK_TOKEN_PUBLIC_KEY,
  tokenDisplay: {
    name: "BALLISTIK.APP",
    symbol: "BALLISTIK",
    publicKey: MARKETING_MOCK_TOKEN_PUBLIC_KEY,
    imageUrl: "/ballistik.png" as string | null,
    twitterUrl: "https://x.com" as string | null,
    telegramUrl: "https://t.me" as string | null,
    websiteUrl: "https://ballistik.app" as string | null,
  },
  refreshStatusLabel: "Last refresh 1m ago",
  headerWallet: {
    name: "Ballistik Wallet",
    truncatedAddress: "ADNd…nqtg",
    balanceSol: 127.4281,
  },
  statsHeader: {
    priceSol,
    marketCapSol,
    marketCapUsd,
    solPriceUsd: ASSUMED_SOL_USD,
  },
  metrics: {
    holdingsValue: {
      valueSol: holdingsValueSol,
      tokenCount: USER_TOKEN_HOLDINGS,
    },
    pnl: {
      net: pnlNet,
      totalBuyVolume: pnlTotalBuyVolume,
      totalSellVolume: pnlTotalSellVolume,
      creatorRewardsClaimedSol: pnlCreatorRewardsClaimedSol,
      platformFees: pnlPlatformFees,
      launchFees: pnlLaunchFees,
      launchFeeBreakdown: {
        generatedWalletFeeSol: 4,
        generatedWalletCount: 6,
        vanityMintFeeSol: 2,
        attributionRemovalFeeSol: 0,
        bundleBuyFeeSol: 12,
      },
      exitFees: pnlExitFees,
      volumeBotFees: pnlVolumeBotFees,
      jitoTipsSol: pnlJitoTipsSol,
      totalFees: pnlTotalFees,
      creationCostSol: pnlCreationCostSol,
    },
    activity: {
      totalVolume: round4(activityBuyVolume + activitySellVolume),
      buyVolume: activityBuyVolume,
      sellVolume: activitySellVolume,
      transactionCount: activityTransactionCount,
    },
  },
  operations: {
    botSessions: [
      {
        id: "mock-volume-bot-session",
        status: "RUNNING" as const,
        totalTrades: 18_420,
        totalPnlSol: round4(42.86),
        runtimeSeconds: 6 * 3600 + 42 * 60,
        startedAt: new Date(Date.now() - (6 * 3600 + 42 * 60) * 1000),
        stoppedAt: null,
        lastTickAt: new Date(),
        walletCount: 24,
        activeWallets: 22,
      },
    ],
  },
  creatorRewards: {
    claimableSol: round4(18.62),
    paidOutSol: round4(240.15),
    lastReconciledAt: new Date(Date.now() - 2 * 60 * 1000),
  },
  priceHistory: buildPriceHistory(52, 0.15),
  priceChartDescription: "Spot price in SOL (preview)",
};
