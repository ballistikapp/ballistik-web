#!/usr/bin/env tsx
/**
 * Refreshes SPL token holdings (ATA balances) for every token’s tracked wallets
 * and writes through to the Holding table — same rules as holdingService.refreshByToken,
 * without going through tRPC or user session checks.
 *
 * Usage:
 *   tsx scripts/refresh-all-holdings.ts [--out path/to/results.json]
 *
 * Requires DATABASE_URL (or PROD_STORAGE_POSTGRES_URL / DEV_STORAGE_POSTGRES_URL)
 * and SOLANA_RPC_URL (e.g. from .env).
 *
 * Output includes `sellable` (wallets with on-chain token balance > 0) and per-token
 * `sellable` / `mintStatus`. Missing or invalid mints are skipped (no RPC ATA batch, no DB writes).
 */

import { Connection, PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddress } from "@solana/spl-token";
import * as dotenv from "dotenv";
import { writeFileSync } from "fs";
import { join } from "path";
import { Pool } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import {
  PrismaClient,
  type Prisma,
} from "../lib/generated/prisma/client";
import { WalletType, type WalletType as WalletTypeValue } from "../lib/generated/prisma/enums";
import { mapWithConcurrency } from "../lib/utils/async";
import { retryRpc } from "../lib/utils/rpc-retry";

dotenv.config({ path: join(process.cwd(), ".env"), quiet: true });
dotenv.config({ path: join(process.cwd(), ".env.local"), quiet: true });
dotenv.config({ path: join(process.cwd(), ".env.development.local"), quiet: true });

const connectionString =
  process.env.DATABASE_URL ||
  process.env.PROD_STORAGE_POSTGRES_URL ||
  process.env.DEV_STORAGE_POSTGRES_URL;

const rpcUrl = process.env.SOLANA_RPC_URL;

if (!connectionString) {
  console.error(
    "Set DATABASE_URL or PROD_STORAGE_POSTGRES_URL / DEV_STORAGE_POSTGRES_URL."
  );
  process.exit(1);
}

if (!rpcUrl) {
  console.error("Set SOLANA_RPC_URL.");
  process.exit(1);
}

const pool = new Pool({ connectionString });
const prisma = new PrismaClient({
  adapter: new PrismaPg(pool),
  log: ["error"],
});

const connection = new Connection(rpcUrl, "confirmed");

const HOLDING_RPC_BATCH_SIZE = 100;
const HOLDING_RPC_CONCURRENCY = 3;
const HOLDING_MUTATION_BATCH_SIZE = 100;
const HOLDING_MUTATION_CONCURRENCY = 3;
const HOLDING_UPDATE_BATCH_SIZE = 50;

const args = process.argv.slice(2);
let outFile = join(process.cwd(), "holding-refresh-results.json");
for (let i = 0; i < args.length; i += 1) {
  if (args[i] === "--out" || args[i] === "-o") {
    outFile = args[i + 1] ?? outFile;
    i += 1;
  }
}

type WalletRecord = { publicKey: string; type: WalletTypeValue };

type HoldingRowLike = {
  id: string;
  walletPublicKey: string;
  lastUpdated: Date;
  createdAt: Date;
};

function dedupeWalletsByPublicKey<T extends { publicKey: string }>(wallets: T[]) {
  return Array.from(
    new Map(wallets.map((wallet) => [wallet.publicKey, wallet])).values()
  );
}

function compareHoldingsByRecency<T extends HoldingRowLike>(a: T, b: T) {
  const lastUpdatedDiff = b.lastUpdated.getTime() - a.lastUpdated.getTime();
  if (lastUpdatedDiff !== 0) return lastUpdatedDiff;
  const createdAtDiff = b.createdAt.getTime() - a.createdAt.getTime();
  if (createdAtDiff !== 0) return createdAtDiff;
  return b.id.localeCompare(a.id);
}

function splitHoldingsByWallet<T extends HoldingRowLike>(holdings: T[]) {
  const holdingsByWallet = new Map<string, T[]>();
  for (const holding of holdings) {
    const existing = holdingsByWallet.get(holding.walletPublicKey) ?? [];
    existing.push(holding);
    holdingsByWallet.set(holding.walletPublicKey, existing);
  }

  const canonicalByWallet = new Map<string, T>();
  const duplicateIdsByWallet = new Map<string, string[]>();

  for (const [walletPublicKey, walletHoldings] of holdingsByWallet) {
    const sorted = [...walletHoldings].sort(compareHoldingsByRecency);
    const canonical = sorted[0];
    if (!canonical) continue;
    canonicalByWallet.set(walletPublicKey, canonical);
    duplicateIdsByWallet.set(
      walletPublicKey,
      sorted.slice(1).map((holding) => holding.id)
    );
  }

  return { canonicalByWallet, duplicateIdsByWallet };
}

type BalanceResult = {
  wallet: WalletRecord;
  tokenBalance: number;
  ataExists: boolean;
  isResolved: boolean;
};

type MintMeta =
  | {
      ok: true;
      mintPubkey: PublicKey;
      tokenProgramId: PublicKey;
      mintDecimals: number;
    }
  | { ok: false; mintStatus: "mint_not_found" | "invalid_mint_key" };

async function resolveMintMeta(tokenPublicKey: string): Promise<MintMeta> {
  let mintPubkey: PublicKey;
  try {
    mintPubkey = new PublicKey(tokenPublicKey);
  } catch {
    return { ok: false, mintStatus: "invalid_mint_key" };
  }

  const mintInfo = await retryRpc(() => connection.getParsedAccountInfo(mintPubkey));
  const tokenProgramId = mintInfo.value?.owner;
  if (!tokenProgramId) {
    return { ok: false, mintStatus: "mint_not_found" };
  }

  const mintDecimals =
    (
      mintInfo.value?.data as {
        parsed?: { info?: { decimals?: number } };
      }
    )?.parsed?.info?.decimals ?? 9;

  return { ok: true, mintPubkey, tokenProgramId, mintDecimals };
}

type ParsedAccountInfoItem = Awaited<
  ReturnType<Connection["getMultipleParsedAccounts"]>
>["value"][number];

async function fetchAtaBalancesForWallets(
  wallets: WalletRecord[],
  mintPubkey: PublicKey,
  tokenProgramId: PublicKey,
  mintDecimals: number
): Promise<BalanceResult[]> {
  const atas = await Promise.all(
    wallets.map(async (wallet) => ({
      wallet,
      ata: await getAssociatedTokenAddress(
        mintPubkey,
        new PublicKey(wallet.publicKey),
        false,
        tokenProgramId
      ),
    }))
  );

  const ataAddresses = atas.map((a) => a.ata);
  const ataBatches: PublicKey[][] = [];
  for (let i = 0; i < ataAddresses.length; i += HOLDING_RPC_BATCH_SIZE) {
    ataBatches.push(ataAddresses.slice(i, i + HOLDING_RPC_BATCH_SIZE));
  }

  const batchedInfos = await mapWithConcurrency(
    ataBatches,
    HOLDING_RPC_CONCURRENCY,
    async (batch) => await retryRpc(() => connection.getMultipleParsedAccounts(batch))
  );
  const accountInfos: ParsedAccountInfoItem[] = batchedInfos.flatMap(
    (batchInfo) => batchInfo.value
  );

  return atas.map(({ wallet }, index) => {
    const accountInfo = accountInfos[index];
    const ataExists = Boolean(accountInfo?.data);
    let tokenBalance = 0;
    if (accountInfo?.data && "parsed" in accountInfo.data) {
      const parsed = accountInfo.data.parsed as {
        info?: { tokenAmount?: { uiAmount?: number } };
      };
      tokenBalance = parsed?.info?.tokenAmount?.uiAmount ?? 0;
    }
    return { wallet, tokenBalance, ataExists, isResolved: true };
  });
}

async function collectWalletsForToken(
  tokenPublicKey: string,
  userId: string
): Promise<WalletRecord[]> {
  const [operationalWallets, devWallet, user, holdingWallets] = await Promise.all([
    prisma.wallet.findMany({
      where: {
        tokenPublicKey,
        type: { in: ["BUNDLER", "VOLUME", "DISTRIBUTION"] },
      },
      select: { publicKey: true, type: true },
    }),
    prisma.tokenDevWallet.findFirst({
      where: { tokenPublicKey },
      select: { wallet: { select: { publicKey: true, type: true } } },
    }),
    prisma.user.findUnique({
      where: { id: userId },
      select: { mainWallet: { select: { publicKey: true, type: true } } },
    }),
    prisma.holding.findMany({
      where: { tokenPublicKey },
      distinct: ["walletPublicKey"],
      select: { walletPublicKey: true },
    }),
  ]);

  const placeholderType = operationalWallets[0]?.type ?? WalletType.BUNDLER;
  const fromHoldings: WalletRecord[] = holdingWallets.map((h) => ({
    publicKey: h.walletPublicKey,
    type: placeholderType,
  }));

  return dedupeWalletsByPublicKey<WalletRecord>([
    ...(user?.mainWallet ? [user.mainWallet] : []),
    ...(devWallet?.wallet ? [devWallet.wallet] : []),
    ...operationalWallets,
    ...fromHoldings,
  ]);
}

type SellableRow = {
  walletPublicKey: string;
  walletType: string;
  tokenBalance: number;
};

type TokenOutcome = {
  tokenPublicKey: string;
  tokenSymbol: string;
  tokenName: string;
  walletCount: number;
  mintStatus: "ok" | "mint_not_found" | "invalid_mint_key" | "failed";
  created: number;
  updated: number;
  deleted: number;
  sellable: SellableRow[];
  sellableWalletCount: number;
  sellableTotalUi: number;
  error?: string;
};

async function refreshHoldingsForToken(
  token: {
    publicKey: string;
    userId: string;
    name: string;
    symbol: string;
    imageUrl: string | null;
  }
): Promise<TokenOutcome> {
  const baseOutcome = (
    partial: Pick<
      TokenOutcome,
      | "walletCount"
      | "mintStatus"
      | "created"
      | "updated"
      | "deleted"
      | "sellable"
      | "sellableWalletCount"
      | "sellableTotalUi"
    > &
      Partial<Pick<TokenOutcome, "error">>
  ): TokenOutcome => ({
    tokenPublicKey: token.publicKey,
    tokenSymbol: token.symbol,
    tokenName: token.name,
    ...partial,
  });

  const wallets = await collectWalletsForToken(token.publicKey, token.userId);
  if (wallets.length === 0) {
    return baseOutcome({
      walletCount: 0,
      mintStatus: "ok",
      created: 0,
      updated: 0,
      deleted: 0,
      sellable: [],
      sellableWalletCount: 0,
      sellableTotalUi: 0,
    });
  }

  const mintMeta = await resolveMintMeta(token.publicKey);
  if (!mintMeta.ok) {
    return baseOutcome({
      walletCount: wallets.length,
      mintStatus: mintMeta.mintStatus,
      created: 0,
      updated: 0,
      deleted: 0,
      sellable: [],
      sellableWalletCount: 0,
      sellableTotalUi: 0,
    });
  }

  const balanceResults = await fetchAtaBalancesForWallets(
    wallets,
    mintMeta.mintPubkey,
    mintMeta.tokenProgramId,
    mintMeta.mintDecimals
  );

  const sellableRows: SellableRow[] = balanceResults
    .filter((r) => r.isResolved && r.tokenBalance > 0)
    .map((r) => ({
      walletPublicKey: r.wallet.publicKey,
      walletType: r.wallet.type,
      tokenBalance: r.tokenBalance,
    }));
  const sellableTotalUi = sellableRows.reduce((s, r) => s + r.tokenBalance, 0);

  const walletPublicKeys = wallets.map((w) => w.publicKey);
  const existingHoldings = await prisma.holding.findMany({
    where: {
      walletPublicKey: { in: walletPublicKeys },
      tokenPublicKey: token.publicKey,
    },
    select: {
      id: true,
      walletPublicKey: true,
      tokenBalance: true,
      totalBuyAmount: true,
      totalSellAmount: true,
      averageBuyPrice: true,
      lastTransactionSignature: true,
      mintAddress: true,
      tokenName: true,
      tokenSymbol: true,
      tokenImageUrl: true,
      tokenDecimals: true,
      lastUpdated: true,
      createdAt: true,
    },
  });

  const { canonicalByWallet, duplicateIdsByWallet } =
    splitHoldingsByWallet(existingHoldings);

  const persistedCandidates = balanceResults.filter(
    (result) => result.isResolved && (result.tokenBalance > 0 || result.ataExists)
  );
  const candidateWalletPublicKeys = Array.from(
    new Set(persistedCandidates.map((result) => result.wallet.publicKey))
  );

  const lastTransactions =
    candidateWalletPublicKeys.length > 0
      ? await prisma.$queryRaw<
          Array<{ walletPublicKey: string; transactionSignature: string }>
        >`
            SELECT DISTINCT ON ("walletPublicKey")
              "walletPublicKey",
              "transactionSignature"
            FROM "Transaction"
            WHERE "walletPublicKey" = ANY(${candidateWalletPublicKeys})
              AND "tokenPublicKey" = ${token.publicKey}
            ORDER BY "walletPublicKey", "createdAt" DESC
          `
      : [];

  const lastTxMap = new Map<string, string>();
  for (const tx of lastTransactions) {
    lastTxMap.set(tx.walletPublicKey, tx.transactionSignature);
  }

  const mintDecimals = mintMeta.mintDecimals;
  const tokenImageUrl = token.imageUrl ?? "";
  const now = new Date();
  const createManyData: Prisma.HoldingCreateManyInput[] = [];
  const deleteIds: string[] = [];
  const updateInputs: Array<{ id: string; data: Prisma.HoldingUpdateInput }> = [];

  for (const { wallet, tokenBalance, ataExists, isResolved } of balanceResults) {
    if (!isResolved) continue;

    const shouldPersist = tokenBalance > 0 || ataExists;
    const existing = canonicalByWallet.get(wallet.publicKey);
    const duplicateIds = duplicateIdsByWallet.get(wallet.publicKey) ?? [];

    if (!shouldPersist) {
      if (existing) deleteIds.push(existing.id);
      deleteIds.push(...duplicateIds);
      continue;
    }

    const lastTxSignature = lastTxMap.get(wallet.publicKey) ?? "";
    const baseData = {
      tokenBalance,
      totalBuyAmount: 0,
      totalSellAmount: 0,
      averageBuyPrice: 0,
      lastTransactionSignature: lastTxSignature,
      mintAddress: token.publicKey,
      tokenName: token.name,
      tokenSymbol: token.symbol,
      tokenImageUrl,
      tokenDecimals: mintDecimals,
    };

    if (!existing) {
      createManyData.push({
        walletPublicKey: wallet.publicKey,
        tokenPublicKey: token.publicKey,
        ...baseData,
        lastUpdated: now,
      });
      deleteIds.push(...duplicateIds);
      continue;
    }

    const hasChanges =
      Number(existing.tokenBalance) !== tokenBalance ||
      Number(existing.totalBuyAmount) !== 0 ||
      Number(existing.totalSellAmount) !== 0 ||
      Number(existing.averageBuyPrice) !== 0 ||
      existing.lastTransactionSignature !== lastTxSignature ||
      existing.mintAddress !== token.publicKey ||
      existing.tokenName !== token.name ||
      existing.tokenSymbol !== token.symbol ||
      existing.tokenImageUrl !== tokenImageUrl ||
      existing.tokenDecimals !== mintDecimals;

    if (!hasChanges) {
      deleteIds.push(...duplicateIds);
      continue;
    }

    updateInputs.push({
      id: existing.id,
      data: { ...baseData, lastUpdated: now },
    });
    deleteIds.push(...duplicateIds);
  }

  const uniqueDeleteIds = Array.from(new Set(deleteIds));

  if (uniqueDeleteIds.length > 0) {
    const deleteBatches: string[][] = [];
    for (let i = 0; i < uniqueDeleteIds.length; i += HOLDING_MUTATION_BATCH_SIZE) {
      deleteBatches.push(uniqueDeleteIds.slice(i, i + HOLDING_MUTATION_BATCH_SIZE));
    }
    await mapWithConcurrency(
      deleteBatches,
      HOLDING_MUTATION_CONCURRENCY,
      async (batch) =>
        prisma.holding.deleteMany({ where: { id: { in: batch } } })
    );
  }

  if (createManyData.length > 0) {
    const createBatches: Prisma.HoldingCreateManyInput[][] = [];
    for (let i = 0; i < createManyData.length; i += HOLDING_MUTATION_BATCH_SIZE) {
      createBatches.push(createManyData.slice(i, i + HOLDING_MUTATION_BATCH_SIZE));
    }
    await mapWithConcurrency(createBatches, HOLDING_MUTATION_CONCURRENCY, async (batch) =>
      prisma.holding.createMany({ data: batch })
    );
  }

  if (updateInputs.length > 0) {
    const updateBatches: Array<typeof updateInputs> = [];
    for (let i = 0; i < updateInputs.length; i += HOLDING_UPDATE_BATCH_SIZE) {
      updateBatches.push(updateInputs.slice(i, i + HOLDING_UPDATE_BATCH_SIZE));
    }
    await mapWithConcurrency(
      updateBatches,
      HOLDING_MUTATION_CONCURRENCY,
      async (batch) =>
        prisma.$transaction(
          batch.map((update) =>
            prisma.holding.update({
              where: { id: update.id },
              data: update.data,
            })
          )
        )
    );
  }

  return baseOutcome({
    walletCount: wallets.length,
    mintStatus: "ok",
    created: createManyData.length,
    updated: updateInputs.length,
    deleted: uniqueDeleteIds.length,
    sellable: sellableRows,
    sellableWalletCount: sellableRows.length,
    sellableTotalUi,
  });
}

async function main() {
  const startedAt = new Date().toISOString();
  console.log("Loading tokens…");
  const tokens = await prisma.token.findMany({
    select: {
      publicKey: true,
      userId: true,
      name: true,
      symbol: true,
      imageUrl: true,
    },
    orderBy: { publicKey: "asc" },
  });

  const outcomes: TokenOutcome[] = [];
  let i = 0;
  for (const token of tokens) {
    i += 1;
    process.stdout.write(`[${i}/${tokens.length}] ${token.publicKey.slice(0, 8)}…\n`);
    try {
      outcomes.push(await refreshHoldingsForToken(token));
    } catch (err) {
      outcomes.push({
        tokenPublicKey: token.publicKey,
        tokenSymbol: token.symbol,
        tokenName: token.name,
        walletCount: 0,
        mintStatus: "failed",
        created: 0,
        updated: 0,
        deleted: 0,
        sellable: [],
        sellableWalletCount: 0,
        sellableTotalUi: 0,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const completedAt = new Date().toISOString();
  const sellable: Array<
    SellableRow & { tokenPublicKey: string; tokenSymbol: string; tokenName: string }
  > = [];
  for (const o of outcomes) {
    if (o.error || o.mintStatus !== "ok") continue;
    for (const row of o.sellable) {
      sellable.push({
        tokenPublicKey: o.tokenPublicKey,
        tokenSymbol: o.tokenSymbol,
        tokenName: o.tokenName,
        ...row,
      });
    }
  }

  const summary = {
    startedAt,
    completedAt,
    tokenCount: tokens.length,
    mintOkCount: outcomes.filter((o) => o.mintStatus === "ok" && !o.error).length,
    mintNotFoundCount: outcomes.filter((o) => o.mintStatus === "mint_not_found").length,
    invalidMintKeyCount: outcomes.filter((o) => o.mintStatus === "invalid_mint_key").length,
    errorCount: outcomes.filter((o) => o.error).length,
    totalCreated: outcomes.reduce((s, o) => s + o.created, 0),
    totalUpdated: outcomes.reduce((s, o) => s + o.updated, 0),
    totalDeleted: outcomes.reduce((s, o) => s + o.deleted, 0),
    sellableWalletRows: sellable.length,
    sellableTokenCount: new Set(sellable.map((r) => r.tokenPublicKey)).size,
    sellableTotalUiAllTokens: sellable.reduce((s, r) => s + r.tokenBalance, 0),
  };

  writeFileSync(
    outFile,
    JSON.stringify({ summary, sellable, tokens: outcomes }, null, 2),
    "utf8"
  );
  console.log(`Done. Wrote ${outFile}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
