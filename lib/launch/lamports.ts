const LAMPORTS_PER_SOL = 1_000_000_000;

/** Convert SOL to an integer lamport decimal string. */
export function solToLamportsString(sol: number): string {
  return BigInt(Math.round(sol * LAMPORTS_PER_SOL)).toString();
}

/** Convert integer lamport decimal strings to SOL for display. */
export function lamportsStringToSol(lamports: string): number {
  return Number(lamports) / LAMPORTS_PER_SOL;
}

/** Format a lamport decimal string as fixed-precision SOL for UI. */
export function formatLamportsAsSol(
  lamports: string,
  fractionDigits = 4
): string {
  return lamportsStringToSol(lamports).toFixed(fractionDigits);
}

export function findMoneyLineItem(
  lineItems: ReadonlyArray<{ label: string; amountLamports: string }>,
  label: string
): string | undefined {
  return lineItems.find((item) => item.label === label)?.amountLamports;
}
