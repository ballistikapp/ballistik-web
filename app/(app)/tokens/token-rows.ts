export type TokenTableStatus = "PENDING" | "ACTIVE" | "FAILED";

export type TokenRowSource = {
  publicKey: string;
  status: string;
  name: string;
  symbol: string;
  imageUrl?: string | null;
  websiteUrl?: string | null;
  twitterUrl?: string | null;
  telegramUrl?: string | null;
  createdAt: Date | string;
  isLegacy?: boolean;
};

export type TokenTableRow = {
  id: string;
  name: string;
  symbol: string;
  status: TokenTableStatus;
  publicKey: string;
  imageUrl?: string | null;
  websiteUrl?: string | null;
  twitterUrl?: string | null;
  telegramUrl?: string | null;
  createdAt: Date | string;
  isLegacy: boolean;
};

const TOKEN_STATUSES = new Set<TokenTableStatus>([
  "PENDING",
  "ACTIVE",
  "FAILED",
]);

function toTokenTableStatus(status: string): TokenTableStatus {
  if (TOKEN_STATUSES.has(status as TokenTableStatus)) {
    return status as TokenTableStatus;
  }
  return "PENDING";
}

export function mapUserTokenToTableRow(token: TokenRowSource): TokenTableRow {
  return {
    id: token.publicKey,
    name: token.name,
    symbol: token.symbol,
    status: toTokenTableStatus(token.status),
    publicKey: token.publicKey,
    imageUrl: token.imageUrl,
    websiteUrl: token.websiteUrl,
    twitterUrl: token.twitterUrl,
    telegramUrl: token.telegramUrl,
    createdAt: token.createdAt,
    isLegacy: token.isLegacy ?? false,
  };
}
