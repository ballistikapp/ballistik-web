"use client";

import React, { createContext, useContext, useState } from "react";

const SELECTED_TOKEN_KEY = "selected-token-public-key";

interface TokenContextValue {
  selectedTokenPublicKey: string | null;
  setSelectedTokenPublicKey: (tokenPublicKey: string | null) => void;
}

const TokenContext = createContext<TokenContextValue | null>(null);

export function TokenProvider({ children }: { children: React.ReactNode }) {
  const [selectedTokenPublicKey, setSelectedTokenPublicKeyState] = useState<
    string | null
  >(() => {
    if (typeof window === "undefined") {
      return null;
    }
    return localStorage.getItem(SELECTED_TOKEN_KEY);
  });

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
