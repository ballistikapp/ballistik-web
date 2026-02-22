export function formatSol(value: number): string {
  if (Math.abs(value) >= 1_000_000)
    return `${(value / 1_000_000).toFixed(2)}M`;
  if (Math.abs(value) >= 1_000) return `${(value / 1_000).toFixed(2)}K`;
  if (Math.abs(value) < 0.0001 && value !== 0) return value.toExponential(2);
  return value.toFixed(4);
}

export function formatPriceSol(price: number): string {
  if (price === 0) return "0";
  if (price < 0.000001) return price.toExponential(4);
  if (price < 0.001) return price.toFixed(9);
  if (price < 1) return price.toFixed(6);
  return price.toFixed(4);
}

export function formatMarketCap(sol: number): string {
  if (sol >= 1_000_000) return `${(sol / 1_000_000).toFixed(2)}M`;
  if (sol >= 1_000) return `${(sol / 1_000).toFixed(2)}K`;
  if (sol >= 1) return sol.toFixed(2);
  return sol.toFixed(4);
}

export function formatUsd(value: number): string {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(2)}K`;
  if (value >= 1) return `$${value.toFixed(2)}`;
  if (value > 0) return `$${value.toFixed(4)}`;
  return "$0";
}

export function formatTokenCount(value: number): string {
  if (value >= 1_000_000_000)
    return `${(value / 1_000_000_000).toFixed(2)}B`;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return value.toFixed(0);
}

export function formatPrice(price: number): string {
  if (price === 0) return "—";
  if (price < 0.000001) return price.toExponential(3);
  if (price < 0.001) return price.toFixed(9);
  if (price < 1) return price.toFixed(6);
  return price.toFixed(4);
}

export function truncateAddress(address: string): string {
  return `${address.slice(0, 4)}...${address.slice(-4)}`;
}

export function formatTimeAgo(date: string | Date): string {
  const now = new Date();
  const then = new Date(date);
  const diffMs = now.getTime() - then.getTime();
  const diffSecs = Math.floor(diffMs / 1000);
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffSecs < 30) return "just now";
  if (diffMins < 1) return `${diffSecs}s ago`;
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 30) return `${diffDays}d ago`;
  return then.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function formatRuntime(seconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(seconds));
  if (safeSeconds < 300) return `${safeSeconds}s`;
  const mins = Math.floor(safeSeconds / 60);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  const remainMins = mins % 60;
  if (hours < 24) return `${hours}h ${remainMins}m`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
}
