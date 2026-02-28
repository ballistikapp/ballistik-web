export const cacheConfig = {
  staleMs: {
    transactions: 300_000,
    holdings: 300_000,
    wallets: 300_000,
  },
  cooldownMs: {
    walletBalances: 5_000,
    walletBalancesWithSubscription: 30_000,
    holdingRefresh: 15_000,
    holdingRefreshWithSubscription: 60_000,
    transactionRefresh: 15_000,
    transactionRefreshWithSubscription: 60_000,
  },
  ttlMs: {
    bondingCurve: 5_000,
    shyftApiResponse: 10_000,
  },
};
