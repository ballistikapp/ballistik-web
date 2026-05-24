import "server-only";
import { AddressLookupTableAccount, PublicKey } from "@solana/web3.js";

import { getEnv } from "@/lib/config/env";
import { getSolanaConnection } from "@/lib/solana/connection";
import { logger } from "@/lib/logger";
import { getGlobalSnapshot } from "@/server/solana/pump/global-account";

const LAUNCH_ALT_TTL_MS = 5 * 60 * 1000;

let altCache: { value: AddressLookupTableAccount; cachedAt: number } | null =
  null;
let altInflight: Promise<AddressLookupTableAccount> | null = null;

async function fetchAndValidateLaunchAlt(): Promise<AddressLookupTableAccount> {
  const { LAUNCH_LOOKUP_TABLE_ADDRESS } = getEnv();
  if (!LAUNCH_LOOKUP_TABLE_ADDRESS) {
    throw new Error(
      "LAUNCH_LOOKUP_TABLE_ADDRESS is not set. Run scripts/create-launch-alt.ts to bootstrap the ALT, then set the address in .env."
    );
  }

  const connection = getSolanaConnection();
  const altAddress = new PublicKey(LAUNCH_LOOKUP_TABLE_ADDRESS);
  const response = await connection.getAddressLookupTable(altAddress);
  const alt = response.value;
  if (!alt) {
    throw new Error(
      `Address Lookup Table not found on-chain: ${LAUNCH_LOOKUP_TABLE_ADDRESS}`
    );
  }

  const globalSnapshot = await getGlobalSnapshot();
  const altAddressSet = new Set(
    alt.state.addresses.map((a) => a.toBase58())
  );
  const missingRecipients = globalSnapshot.buybackFeeRecipients
    .map((p) => p.toBase58())
    .filter((addr) => !altAddressSet.has(addr));

  if (missingRecipients.length > 0) {
    logger.error("Launch ALT is stale — buyback recipients changed", {
      altAddress: LAUNCH_LOOKUP_TABLE_ADDRESS,
      missingFromAlt: missingRecipients,
      currentRecipients: globalSnapshot.buybackFeeRecipients.map((p) =>
        p.toBase58()
      ),
      altAddressCount: alt.state.addresses.length,
      action:
        "Run scripts/create-launch-alt.ts to create a new ALT and update LAUNCH_LOOKUP_TABLE_ADDRESS",
    });
  } else {
    logger.info("Launch ALT loaded and validated", {
      altAddress: LAUNCH_LOOKUP_TABLE_ADDRESS,
      addressCount: alt.state.addresses.length,
    });
  }

  return alt;
}

export async function getLaunchLookupTable(): Promise<AddressLookupTableAccount> {
  if (altCache && Date.now() - altCache.cachedAt < LAUNCH_ALT_TTL_MS) {
    return altCache.value;
  }
  if (altInflight) return altInflight;

  altInflight = (async () => {
    try {
      const alt = await fetchAndValidateLaunchAlt();
      altCache = { value: alt, cachedAt: Date.now() };
      return alt;
    } finally {
      altInflight = null;
    }
  })();

  return altInflight;
}

export function invalidateLaunchLookupTable(): void {
  altCache = null;
}
