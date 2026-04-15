import type { CreateReactUtils } from "@trpc/react-query/shared";
import type { AppRouter } from "@/server/trpc/routers/_app";

type TrpcReactUtils = CreateReactUtils<AppRouter, unknown>;

/**
 * Marks `token.getSidebarCounts` stale so sidebar badges refetch after holdings,
 * token-scoped wallet balances, or volume-bot session state changes for this mint.
 */
export function invalidateTokenSidebarCounts(
  utils: TrpcReactUtils,
  tokenPublicKey: string | null | undefined
): void {
  if (!tokenPublicKey) return;
  void utils.token.getSidebarCounts.invalidate({ publicKey: tokenPublicKey });
}
