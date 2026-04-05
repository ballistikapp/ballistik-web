import "server-only";
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";
import { getSolanaConnection } from "@/lib/solana/connection";
import { retryRpcWithTimeout } from "@/lib/utils/rpc-retry";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";

const PUMP_TOKEN_DECIMALS = 6;
const TOKEN_ACCOUNT_SIZE = 165;
const MINT_OFFSET = 0;
const ACCOUNT_DATA_SLICE_OFFSET = 32;
const ACCOUNT_DATA_SLICE_LENGTH = 40;
const OWNER_OFFSET = 0;
const OWNER_LENGTH = 32;
const AMOUNT_OFFSET = 32;
const log = logger.child({ service: "holders" });

export type CurrentHolder = {
  ownerWallet: string;
  tokenBalance: number;
};

type HoldersCacheEntry = {
  holders: CurrentHolder[];
  cachedAt: number;
};

type TokenAccountData = Buffer | Uint8Array | null;

const CACHE_TTL_MS = 15_000;
const holdersCache = new Map<string, HoldersCacheEntry>();

function normalizeTokenAccountData(accountData: TokenAccountData): Buffer | null {
  if (!accountData) {
    return null;
  }
  return Buffer.isBuffer(accountData) ? accountData : Buffer.from(accountData);
}

function parseOwnerFromTokenAccount(accountData: TokenAccountData): string | null {
  const normalizedData = normalizeTokenAccountData(accountData);
  if (!normalizedData || normalizedData.length < OWNER_OFFSET + OWNER_LENGTH) {
    return null;
  }
  const ownerBytes = normalizedData.subarray(
    OWNER_OFFSET,
    OWNER_OFFSET + OWNER_LENGTH
  );
  return new PublicKey(ownerBytes).toBase58();
}

function parseRawAmountFromTokenAccount(accountData: TokenAccountData): bigint {
  const normalizedData = normalizeTokenAccountData(accountData);
  if (!normalizedData || normalizedData.length < AMOUNT_OFFSET + 8) {
    return BigInt(0);
  }
  return normalizedData.readBigUInt64LE(AMOUNT_OFFSET);
}

export function aggregateCurrentHoldersFromTokenAccountData(
  accountDataRows: TokenAccountData[]
): CurrentHolder[] {
  const balancesByOwner = new Map<string, bigint>();

  for (const accountData of accountDataRows) {
    const ownerWallet = parseOwnerFromTokenAccount(accountData);
    if (!ownerWallet) continue;

    const rawAmount = parseRawAmountFromTokenAccount(accountData);
    if (rawAmount <= BigInt(0)) continue;

    balancesByOwner.set(
      ownerWallet,
      (balancesByOwner.get(ownerWallet) ?? BigInt(0)) + rawAmount
    );
  }

  return Array.from(balancesByOwner.entries())
    .map(([ownerWallet, rawAmount]) => ({
      ownerWallet,
      tokenBalance: Number(rawAmount) / 10 ** PUMP_TOKEN_DECIMALS,
    }))
    .sort((a, b) => b.tokenBalance - a.tokenBalance);
}

export function aggregateCurrentHoldersFromTransactionRows(
  rows: Array<{
    walletPublicKey: string;
    transactionType: "BUY" | "SELL" | "CREATE";
    tokenAmount: number;
  }>
): CurrentHolder[] {
  const balancesByOwner = new Map<string, number>();

  for (const row of rows) {
    const direction = row.transactionType === "SELL" ? -1 : 1;
    const nextBalance =
      (balancesByOwner.get(row.walletPublicKey) ?? 0) +
      direction * row.tokenAmount;
    balancesByOwner.set(row.walletPublicKey, nextBalance);
  }

  return Array.from(balancesByOwner.entries())
    .filter(([, tokenBalance]) => tokenBalance > 0)
    .map(([ownerWallet, tokenBalance]) => ({
      ownerWallet,
      tokenBalance: Math.round(tokenBalance * 1_000_000) / 1_000_000,
    }))
    .sort((a, b) => b.tokenBalance - a.tokenBalance);
}

function setCachedHolders(tokenPublicKey: string, holders: CurrentHolder[]) {
  holdersCache.set(tokenPublicKey, {
    holders,
    cachedAt: Date.now(),
  });

  if (holdersCache.size > 100) {
    const oldestKey = holdersCache.keys().next().value;
    if (oldestKey) holdersCache.delete(oldestKey);
  }
}

async function getCurrentHoldersForProgram(
  mint: PublicKey,
  programId: PublicKey
): Promise<CurrentHolder[]> {
  const connection = getSolanaConnection();
  const filters =
    programId.equals(TOKEN_2022_PROGRAM_ID)
      ? [{ memcmp: { offset: MINT_OFFSET, bytes: mint.toBase58() } }]
      : [
          { dataSize: TOKEN_ACCOUNT_SIZE },
          { memcmp: { offset: MINT_OFFSET, bytes: mint.toBase58() } },
        ];
  const tokenAccounts = await retryRpcWithTimeout(() =>
    connection.getProgramAccounts(programId, {
      commitment: "confirmed",
      filters,
      // Fetch only owner + raw amount bytes for lightweight full-holder scans.
      dataSlice: {
        offset: ACCOUNT_DATA_SLICE_OFFSET,
        length: ACCOUNT_DATA_SLICE_LENGTH,
      },
    })
  );

  return aggregateCurrentHoldersFromTokenAccountData(
    tokenAccounts.map((account) => account.account.data)
  );
}

async function getCurrentHoldersFromRpc(mint: PublicKey): Promise<{
  holders: CurrentHolder[];
  failures: string[];
  hadSuccessfulLookup: boolean;
}> {
  const failures: string[] = [];
  let hadSuccessfulLookup = false;

  for (const programId of [TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID]) {
    try {
      const holders = await getCurrentHoldersForProgram(mint, programId);
      hadSuccessfulLookup = true;

      if (holders.length > 0) {
        return { holders, failures, hadSuccessfulLookup };
      }
    } catch (error) {
      failures.push(
        `${programId.toBase58()}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  return {
    holders: [],
    failures,
    hadSuccessfulLookup,
  };
}

async function getCurrentHoldersFromTransactions(
  tokenPublicKey: string
): Promise<CurrentHolder[]> {
  const rows = await prisma.tokenTransaction.findMany({
    where: {
      tokenPublicKey,
      status: "CONFIRMED",
      transactionType: { in: ["BUY", "SELL", "CREATE"] },
    },
    select: {
      walletPublicKey: true,
      transactionType: true,
      tokenAmount: true,
    },
  });

  return aggregateCurrentHoldersFromTransactionRows(
    rows.map((row) => ({
      walletPublicKey: row.walletPublicKey,
      transactionType: row.transactionType,
      tokenAmount: Number(row.tokenAmount),
    }))
  );
}

export const holdersService = {
  async getCurrentHolders(tokenPublicKey: string): Promise<CurrentHolder[]> {
    const cached = holdersCache.get(tokenPublicKey);
    if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) {
      return cached.holders;
    }

    const mint = new PublicKey(tokenPublicKey);
    const rpcResult = await getCurrentHoldersFromRpc(mint);
    if (rpcResult.hadSuccessfulLookup) {
      setCachedHolders(tokenPublicKey, rpcResult.holders);
      return rpcResult.holders;
    }

    try {
      const fallbackHolders = await getCurrentHoldersFromTransactions(
        tokenPublicKey,
      );
      setCachedHolders(tokenPublicKey, fallbackHolders);
      log.warn("Holder lookup unavailable with current RPC provider, using transaction fallback", {
        tokenPublicKey,
        failures: rpcResult.failures,
        fallbackHolderCount: fallbackHolders.length,
      });
      return fallbackHolders;
    } catch (error) {
      log.warn("Holder lookup unavailable and transaction fallback failed", {
        tokenPublicKey,
        failures: rpcResult.failures,
        fallbackError: error instanceof Error ? error.message : String(error),
      });
    }

    setCachedHolders(tokenPublicKey, []);
    return [];
  },
};
