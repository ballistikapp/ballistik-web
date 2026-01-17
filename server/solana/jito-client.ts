import { searcher } from "jito-ts";
import { PublicKey } from "@solana/web3.js";

const endpoint =
  process.env.JITO_BLOCK_ENGINE_URL || "mainnet.block-engine.jito.wtf";
const client = searcher.searcherClient(endpoint);
const TIP_CACHE_TTL_MS = 60_000;

let tipCacheTime = 0;
let tipAccounts: PublicKey[] | null = null;

export async function getTipAccount() {
  const now = Date.now();
  if (tipAccounts && now - tipCacheTime < TIP_CACHE_TTL_MS) {
    return tipAccounts[0];
  }

  const response = (await client.getTipAccounts()) as
    | { ok: true; value: string[] }
    | { ok: false; error: string }
    | string[];

  if (Array.isArray(response)) {
    tipAccounts = response.map((addr) => new PublicKey(addr));
  } else if (response.ok) {
    tipAccounts = response.value.map((addr) => new PublicKey(addr));
  } else {
    throw new Error(response.error || "Failed to fetch tip accounts");
  }

  if (!tipAccounts || tipAccounts.length === 0) {
    throw new Error("No tip accounts available");
  }

  tipCacheTime = now;
  return tipAccounts[0];
}

export async function sendBundle(bundleToSend: import("jito-ts").bundle.Bundle) {
  return client.sendBundle(bundleToSend);
}
