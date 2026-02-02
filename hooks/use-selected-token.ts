"use client";

import { useParams } from "next/navigation";
import { useTokenContext } from "@/contexts/token-context";

export function useSelectedToken() {
  const params = useParams();
  const { selectedTokenPublicKey, setSelectedTokenPublicKey } =
    useTokenContext();

  // If we're on a token-scoped page, use the URL param
  const tokenPublicKeyFromUrl = params?.tokenPublicKey as string | undefined;

  // URL params take precedence over context
  const effectiveTokenPublicKey =
    tokenPublicKeyFromUrl || selectedTokenPublicKey;

  return {
    selectedTokenPublicKey: effectiveTokenPublicKey,
    setSelectedTokenPublicKey,
  };
}
