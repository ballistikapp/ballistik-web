type ComputeRecoverableLamportsInput = {
  balanceLamports: number;
  feeLamports: number;
  rentExemptMinimumLamports: number;
};

type ComputeSponsoredRecoverableLamportsInput = {
  balanceLamports: number;
  feeLamports: number;
};

type ResolveBatchReclaimModeInput = {
  mainWalletBalanceLamports: number;
  walletBalancesLamports: number[];
  sponsoredFeeLamports: number;
};

export type BatchReclaimMode = "main-sponsored" | "source-funded";

export function computeRecoverableLamports({
  balanceLamports,
  feeLamports,
  rentExemptMinimumLamports,
}: ComputeRecoverableLamportsInput): number {
  const recoverableLamports =
    balanceLamports - feeLamports - rentExemptMinimumLamports;

  return recoverableLamports > 0 ? recoverableLamports : 0;
}

export function computeSponsoredRecoverableLamports({
  balanceLamports,
  feeLamports: _feeLamports,
}: ComputeSponsoredRecoverableLamportsInput): number {
  const recoverableLamports = balanceLamports;

  return recoverableLamports > 0 ? recoverableLamports : 0;
}

export function resolveBatchReclaimMode({
  mainWalletBalanceLamports,
  walletBalancesLamports,
  sponsoredFeeLamports,
}: ResolveBatchReclaimModeInput): BatchReclaimMode {
  const reclaimableWalletCount = walletBalancesLamports.filter(
    (balanceLamports) => balanceLamports > 0
  ).length;

  if (reclaimableWalletCount === 0 || sponsoredFeeLamports <= 0) {
    return "main-sponsored";
  }

  return mainWalletBalanceLamports >=
    reclaimableWalletCount * sponsoredFeeLamports
    ? "main-sponsored"
    : "source-funded";
}
