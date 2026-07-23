import { Badge } from "@/components/ui/badge";

function formatCatalogFeeSol(amountSol: number): string {
  return Number(amountSol.toPrecision(12)).toString();
}

type LaunchFeeBadgeProps = {
  amountSol: number;
  /** Unit-price suffix, e.g. "/ wallet" for generated-wallet fees. */
  per?: "wallet";
};

/** Catalog usage-fee chip for launch funnel controls (list price, not waived). */
export function LaunchFeeBadge({ amountSol, per }: LaunchFeeBadgeProps) {
  const amount = formatCatalogFeeSol(amountSol);
  const label =
    per === "wallet" ? `+${amount} SOL / wallet` : `+${amount} SOL`;

  return (
    <Badge variant="secondary" className="font-normal text-muted-foreground">
      {label}
    </Badge>
  );
}
