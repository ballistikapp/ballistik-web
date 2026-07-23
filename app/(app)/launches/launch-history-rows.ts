export type LaunchHistoryStatus =
  | "PENDING"
  | "RUNNING"
  | "SUCCEEDED"
  | "FAILED"
  | "CANCELED";

export type LaunchHistorySource = {
  id: string;
  status: string;
  retriedFromLaunchId: string | null;
  hasRetryAttempts: boolean;
  tokenPublicKey: string | null;
  tokenName: string;
  tokenSymbol: string;
  imageUrl?: string | null;
  websiteUrl?: string | null;
  twitterUrl?: string | null;
  telegramUrl?: string | null;
  errorMessage?: string | null;
  createdAt: Date | string;
  isLegacy?: boolean;
};

export type LaunchHistoryRow = {
  id: string;
  launchId: string;
  name: string;
  symbol: string;
  status: LaunchHistoryStatus;
  publicKey: string | null;
  imageUrl?: string | null;
  websiteUrl?: string | null;
  twitterUrl?: string | null;
  telegramUrl?: string | null;
  createdAt: Date | string;
  errorMessage?: string | null;
  isLegacy: boolean;
  retriedFromLaunchId: string | null;
  hasRetryAttempts: boolean;
};

const LAUNCH_STATUSES = new Set<LaunchHistoryStatus>([
  "PENDING",
  "RUNNING",
  "SUCCEEDED",
  "FAILED",
  "CANCELED",
]);

function toLaunchHistoryStatus(status: string): LaunchHistoryStatus {
  if (LAUNCH_STATUSES.has(status as LaunchHistoryStatus)) {
    return status as LaunchHistoryStatus;
  }
  return "PENDING";
}

export function formatLaunchLineageLabel(input: {
  retriedFromLaunchId: string | null;
  hasRetryAttempts: boolean;
}): string | null {
  const parts: string[] = [];
  if (input.retriedFromLaunchId) {
    const shortId = `${input.retriedFromLaunchId.slice(0, 8)}…`;
    parts.push(`Retry of ${shortId}`);
  }
  if (input.hasRetryAttempts) {
    parts.push("Has retries");
  }
  return parts.length > 0 ? parts.join(" · ") : null;
}

export function mapUserLaunchToHistoryRow(
  launch: LaunchHistorySource
): LaunchHistoryRow {
  return {
    id: launch.id,
    launchId: launch.id,
    name: launch.tokenName,
    symbol: launch.tokenSymbol,
    status: toLaunchHistoryStatus(launch.status),
    publicKey: launch.tokenPublicKey,
    imageUrl: launch.imageUrl,
    websiteUrl: launch.websiteUrl,
    twitterUrl: launch.twitterUrl,
    telegramUrl: launch.telegramUrl,
    createdAt: launch.createdAt,
    errorMessage: launch.errorMessage,
    isLegacy: launch.isLegacy ?? false,
    retriedFromLaunchId: launch.retriedFromLaunchId,
    hasRetryAttempts: launch.hasRetryAttempts,
  };
}
