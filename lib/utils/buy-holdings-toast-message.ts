/** User-facing one-line summary after buy-by-token (holdings / dashboard). */
export type BuyHoldingsToastResult = {
  submitted: number;
  failed: number;
  funding: { funded: number };
  excessReturn: { returned: number; failed: number };
};

export function formatBuyHoldingsToast(result: BuyHoldingsToastResult): string {
  const parts: string[] = [];

  if (result.failed > 0) {
    parts.push(`Buy: ${result.submitted} sent, ${result.failed} failed`);
  } else {
    parts.push(
      result.submitted > 1
        ? `${result.submitted} buys sent`
        : "Buy sent"
    );
  }

  if (result.funding.funded > 0) {
    parts.push(
      result.funding.funded === 1
        ? "1 funded"
        : `${result.funding.funded} funded`
    );
  }

  if (result.excessReturn.returned > 0) {
    parts.push(
      result.excessReturn.returned === 1
        ? "Excess to main"
        : `${result.excessReturn.returned} excess to main`
    );
  }
  if (result.excessReturn.failed > 0) {
    parts.push(
      result.excessReturn.failed === 1
        ? "1 excess return failed"
        : `${result.excessReturn.failed} excess returns failed`
    );
  }

  return parts.join(" · ");
}
