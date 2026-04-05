import "server-only";
type FailureRecoveryResult = {
  publicKey: string;
  status: "returned" | "skipped" | "failed";
  amountSol?: number;
  error?: string;
};

export type FailureRecoverySummary = {
  attempted: boolean;
  manualActionRequired: boolean;
  recoveredWalletCount: number;
  failedWalletCount: number;
  skippedWalletCount: number;
  totalReturnedSol: number;
  failureMessage: string | null;
};

export function computeFailedLaunchDrainLamports(balanceLamports: number) {
  return balanceLamports > 0 ? balanceLamports : 0;
}

export function summarizeFailureRecoveryAttempt(
  results: FailureRecoveryResult[]
): FailureRecoverySummary {
  const recoveredWalletCount = results.filter(
    (result) => result.status === "returned"
  ).length;
  const failedWalletCount = results.filter(
    (result) => result.status === "failed"
  ).length;
  const skippedWalletCount = results.filter(
    (result) => result.status === "skipped"
  ).length;
  const totalReturnedSol = results.reduce((total, result) => {
    if (result.status !== "returned") {
      return total;
    }

    return total + (result.amountSol ?? 0);
  }, 0);

  return {
    attempted: results.length > 0,
    manualActionRequired: failedWalletCount > 0,
    recoveredWalletCount,
    failedWalletCount,
    skippedWalletCount,
    totalReturnedSol,
    failureMessage:
      failedWalletCount > 0
        ? "Automatic reclaim could not return all wallet SOL."
        : null,
  };
}
