/** User-facing one-line summary after sell-by-token (holdings / dashboard). */
export type SellHoldingsToastResult = {
  submitted: number;
  failed: number;
  effectiveReturnSolToMainWallet: boolean;
  ataClose: { closed: number; failed: number } | null;
  solRecovery: { recovered: number; failed: number } | null;
};

export function formatSellHoldingsToast(
  result: SellHoldingsToastResult,
  closeAta: boolean
): string {
  const parts: string[] = [];

  if (result.failed > 0) {
    parts.push(`Sell: ${result.submitted} sent, ${result.failed} failed`);
  } else {
    parts.push(
      result.submitted > 1
        ? `${result.submitted} sells sent`
        : "Sell sent"
    );
  }

  if (closeAta && result.ataClose) {
    if (result.ataClose.closed > 0) {
      parts.push(
        result.ataClose.closed === 1
          ? "ATA closed"
          : `${result.ataClose.closed} ATAs closed`
      );
    }
    if (result.ataClose.failed > 0) {
      parts.push(
        result.ataClose.failed === 1
          ? "1 ATA close failed"
          : `${result.ataClose.failed} ATA closes failed`
      );
    }
  }

  if (result.effectiveReturnSolToMainWallet && result.solRecovery) {
    if (result.solRecovery.recovered > 0) {
      parts.push(
        result.solRecovery.recovered === 1
          ? "SOL to main"
          : `SOL from ${result.solRecovery.recovered} wallets`
      );
    }
    if (result.solRecovery.failed > 0) {
      parts.push(
        result.solRecovery.failed === 1
          ? "1 SOL return failed"
          : `${result.solRecovery.failed} SOL returns failed`
      );
    }
  }

  return parts.join(" · ");
}
