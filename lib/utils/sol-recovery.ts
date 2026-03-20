type ComputeRecoverableLamportsInput = {
  balanceLamports: number;
  feeLamports: number;
  rentExemptMinimumLamports: number;
};

export function computeRecoverableLamports({
  balanceLamports,
  feeLamports,
  rentExemptMinimumLamports,
}: ComputeRecoverableLamportsInput): number {
  const recoverableLamports =
    balanceLamports - feeLamports - rentExemptMinimumLamports;

  return recoverableLamports > 0 ? recoverableLamports : 0;
}
