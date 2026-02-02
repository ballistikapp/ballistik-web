import { useQueryState } from "nuqs";
import { tokenQueryParser } from "@/lib/utils/token-query";
import { trpc } from "@/lib/trpc/client";

export function useTokenQuery() {
  const [tokenPublicKey] = useQueryState("token", tokenQueryParser);

  const {
    data: tokenData,
    isLoading,
    error,
  } = trpc.token.getByPublicKey.useQuery(
    { publicKey: tokenPublicKey || "" },
    { enabled: !!tokenPublicKey }
  );

  const isTokenNotFound =
    !tokenPublicKey ||
    error?.data?.code === "UNAUTHORIZED" ||
    (!isLoading && !tokenData);

  const hasGeneralError = error && !isTokenNotFound;

  return {
    tokenPublicKey,
    tokenData,
    isLoading,
    isTokenNotFound,
    hasGeneralError,
  };
}
