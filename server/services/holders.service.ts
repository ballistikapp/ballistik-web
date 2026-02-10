import { PublicKey, AccountInfo } from "@solana/web3.js";
import { getSolanaConnection } from "@/lib/solana/connection";

const PUMP_TOKEN_DECIMALS = 6;
const OWNER_OFFSET = 32;
const OWNER_LENGTH = 32;

type TopHolder = {
  tokenAccount: string;
  ownerWallet: string;
  tokenBalance: number;
};

type HoldersCacheEntry = {
  holders: TopHolder[];
  cachedAt: number;
};

const CACHE_TTL_MS = 15_000;
const holdersCache = new Map<string, HoldersCacheEntry>();

function parseOwnerFromTokenAccount(
  accountData: Buffer | null
): string | null {
  if (!accountData || accountData.length < OWNER_OFFSET + OWNER_LENGTH) {
    return null;
  }
  const ownerBytes = accountData.subarray(
    OWNER_OFFSET,
    OWNER_OFFSET + OWNER_LENGTH
  );
  return new PublicKey(ownerBytes).toBase58();
}

export const holdersService = {
  async getTopHolders(tokenPublicKey: string): Promise<TopHolder[]> {
    const cached = holdersCache.get(tokenPublicKey);
    if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) {
      return cached.holders;
    }

    try {
      const connection = getSolanaConnection();
      const mint = new PublicKey(tokenPublicKey);

      const largestAccounts = await connection.getTokenLargestAccounts(
        mint,
        "confirmed"
      );

      if (!largestAccounts.value.length) {
        return [];
      }

      const tokenAccountPubkeys = largestAccounts.value.map(
        (a) => new PublicKey(a.address)
      );
      const accountInfos: (AccountInfo<Buffer> | null)[] =
        await connection.getMultipleAccountsInfo(
          tokenAccountPubkeys,
          "confirmed"
        );

      const holders: TopHolder[] = [];
      for (let i = 0; i < largestAccounts.value.length; i++) {
        const account = largestAccounts.value[i];
        const info = accountInfos[i];
        const ownerWallet = parseOwnerFromTokenAccount(
          info?.data as Buffer | null
        );

        if (!ownerWallet) continue;

        const rawAmount = Number(account.amount);
        const tokenBalance = rawAmount / 10 ** PUMP_TOKEN_DECIMALS;

        if (tokenBalance <= 0) continue;

        holders.push({
          tokenAccount: account.address.toBase58(),
          ownerWallet,
          tokenBalance,
        });
      }

      holders.sort((a, b) => b.tokenBalance - a.tokenBalance);

      holdersCache.set(tokenPublicKey, {
        holders,
        cachedAt: Date.now(),
      });

      if (holdersCache.size > 100) {
        const oldestKey = holdersCache.keys().next().value;
        if (oldestKey) holdersCache.delete(oldestKey);
      }

      return holders;
    } catch {
      return [];
    }
  },
};
