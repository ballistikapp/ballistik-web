type WalletBalanceLike = {
  publicKey: string;
  balanceSol?: number | string | null;
};

export function getTotalReclaimableSol(wallets: WalletBalanceLike[]) {
  return wallets.reduce((total, wallet) => {
    const numeric = Number(wallet.balanceSol ?? 0);
    if (!Number.isFinite(numeric)) {
      return total;
    }

    return total + numeric;
  }, 0);
}
