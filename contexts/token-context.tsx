"use client";

import React, { createContext, useContext, useEffect, useState } from "react";

const SELECTED_TOKEN_KEY = "selected-token-public-key";

interface TokenContextValue {
  selectedTokenPublicKey: string | null;
  setSelectedTokenPublicKey: (tokenPublicKey: string | null) => void;
}

const TokenContext = createContext<TokenContextValue | null>(null);

export function TokenProvider({ children }: { children: React.ReactNode }) {
  const [selectedTokenPublicKey, setSelectedTokenPublicKeyState] = useState<
    string | null
  >(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    if (typeof window !== "undefined") {
      const stored = localStorage.getItem(SELECTED_TOKEN_KEY);
      if (stored) {
        setSelectedTokenPublicKeyState(stored);
      }
    }
  }, []);

  const setSelectedTokenPublicKey = (tokenPublicKey: string | null) => {
    setSelectedTokenPublicKeyState(tokenPublicKey);
    if (typeof window !== "undefined") {
      if (tokenPublicKey) {
        localStorage.setItem(SELECTED_TOKEN_KEY, tokenPublicKey);
      } else {
        localStorage.removeItem(SELECTED_TOKEN_KEY);
      }
    }
  };

  if (!mounted) {
    return <>{children}</>;
  }

  return (
    <TokenContext.Provider
      value={{ selectedTokenPublicKey, setSelectedTokenPublicKey }}
    >
      {children}
    </TokenContext.Provider>
  );
}

export function useTokenContext() {
  const context = useContext(TokenContext);
  if (!context) {
    throw new Error("useTokenContext must be used within TokenProvider");
  }
  return context;
}
