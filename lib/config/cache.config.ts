export const cacheConfig = {
  staleMs: {
    transactions: 60_000,
    holdings: 60_000,
    wallets: 60_000,
  },
  cooldownMs: {
    walletBalances: 15_000,
  },
};
