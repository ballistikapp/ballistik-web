"use client";

import { useEffect } from "react";
import { useParams } from "next/navigation";
import { useTokenContext } from "@/contexts/token-context";

export function useSelectedToken() {
  const params = useParams<{ tokenPublicKey?: string }>();
  const { selectedTokenPublicKey, setSelectedTokenPublicKey } =
    useTokenContext();

  const tokenPublicKeyFromUrl = params?.tokenPublicKey;

  useEffect(() => {
    if (
      tokenPublicKeyFromUrl &&
      tokenPublicKeyFromUrl !== selectedTokenPublicKey
    ) {
      setSelectedTokenPublicKey(tokenPublicKeyFromUrl);
    }
  }, [tokenPublicKeyFromUrl, selectedTokenPublicKey, setSelectedTokenPublicKey]);

  const effectiveTokenPublicKey = tokenPublicKeyFromUrl || selectedTokenPublicKey;

  return {
    selectedTokenPublicKey: effectiveTokenPublicKey,
    setSelectedTokenPublicKey,
  };
}
