export const cacheConfig = {
  staleMs: {
    transactions: 30_000,
    holdings: 30_000,
    wallets: 60_000,
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
