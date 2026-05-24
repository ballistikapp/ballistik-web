import "server-only";
import { Prisma, prisma } from "@/lib/prisma";
import { rpcConfig } from "@/lib/config/rpc.config";
import { AppError } from "@/server/errors";
import { getSolanaConnection } from "@/lib/solana/connection";
import { refreshCacheService } from "@/server/services/refresh-cache.service";
import { retryRpc, retryRpcWithTimeout } from "@/lib/utils/rpc-retry";
import { derivePumpAddresses } from "@/server/solana/pump/instructions";
import {
  parsePumpTradeEvents,
  type PumpTradeEvent,
} from "@/server/solana/pump/events";
import {
  LAMPORTS_PER_SOL,
  type ParsedTransactionWithMeta,
  PublicKey,
} from "@solana/web3.js";
import { type WalletType } from "@/lib/generated/prisma/enums";
import { mapWithConcurrency } from "@/lib/utils/async";
import type {
  ListTransactionsByTokenInput,
  RefreshTransactionsByTokenInput,
} from "@/server/schemas/transaction.schema";

type WalletRecord = {
  publicKey: string;
  type: WalletType;
};

type ParsedTransactionResult = {
  walletPublicKey: string;
  transactionType: "BUY" | "SELL" | "CREATE";
  status: "CONFIRMED" | "FAILED";
  transactionSignature: string;
  solAmount: number;
  tokenAmount: number;
  pricePerToken: number;
  slippageBps: number;
  feeAmount: number;
  slot: bigint | null;
  blockTime: Date | null;
  amountSource: "PUMP_EVENT" | "BALANCE_DELTA";
};

export class PendingSignatureIngestionError extends Error {
  signatures: string[];

  constructor(signatures: string[]) {
    super("Some signatures are not yet parseable");
    this.name = "PendingSignatureIngestionError";
    this.signatures = signatures;
  }
}

type TokenTransactionListRow = {
  id: string;
  walletPublicKey: string;
  walletType: WalletType | null;
  isOwned: boolean;
  transactionType: "BUY" | "SELL" | "CREATE";
  status: "PENDING" | "CONFIRMED" | "FAILED";
  transactionSignature: string;
  solAmount: number;
  tokenAmount: number;
  pricePerToken: number;
  slippageBps: number;
  feeAmount: number;
  slot: bigint | null;
  blockTime: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

type TokenTransactionMetrics = {
  buys: { total: number; owned: number; external: number };
  sells: { total: number; owned: number; external: number };
  volume: { total: number; owned: number; external: number };
  traders: { total: number; owned: number; external: number };
};

const WRAPPED_SOL_MINT = "So11111111111111111111111111111111111111112";
const PARSE_RETRY_DELAYS_MS = [200, 500];
const TOKEN_TRANSACTION_UPDATE_BATCH_SIZE = 50;
const DEFAULT_PUMP_TOKEN_DECIMALS = 6;

type TokenBalanceEntry = NonNullable<
  NonNullable<ParsedTransactionWithMeta["meta"]>["preTokenBalances"]
>[number];

function sumTokenBalances(
  balances: TokenBalanceEntry[] | null | undefined,
  owner: string,
  mint: string
) {
  if (!balances?.length) return 0;
  return balances.reduce((total, balance) => {
    if (balance.owner !== owner || balance.mint !== mint) return total;
    const amount = balance.uiTokenAmount?.uiAmount ?? 0;
    return total + amount;
  }, 0);
}

const sleep = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

function sumTokenBalancesByOwner(
  balances: TokenBalanceEntry[] | null | undefined,
  mint: string
) {
  const totals = new Map<string, number>();
  if (!balances?.length) return totals;
  balances.forEach((balance) => {
    if (balance.mint !== mint || !balance.owner) return;
    const amount = balance.uiTokenAmount?.uiAmount ?? 0;
    totals.set(balance.owner, (totals.get(balance.owner) ?? 0) + amount);
  });
  return totals;
}

function getTokenDecimals(
  tx: ParsedTransactionWithMeta,
  mint: string
): number {
  const balances = [
    ...(tx.meta?.preTokenBalances ?? []),
    ...(tx.meta?.postTokenBalances ?? []),
  ];
  const balance = balances.find((entry) => entry.mint === mint);
  return balance?.uiTokenAmount?.decimals ?? DEFAULT_PUMP_TOKEN_DECIMALS;
}

function resolveAccountKey(
  key: ParsedTransactionWithMeta["transaction"]["message"]["accountKeys"][number]
) {
  if (typeof key === "string") return key;
  if (key && typeof key === "object" && "pubkey" in key) {
    const maybePubkey = key.pubkey;
    if (
      maybePubkey &&
      typeof maybePubkey === "object" &&
      "toBase58" in maybePubkey &&
      typeof maybePubkey.toBase58 === "function"
    ) {
      return maybePubkey.toBase58();
    }
  }
  if (key && typeof key === "object" && "toBase58" in key) {
    const toBase58 = key.toBase58;
    if (typeof toBase58 === "function") {
      return toBase58.call(key);
    }
  }
  return null;
}

function getSystemSolDiff(
  tx: ParsedTransactionWithMeta,
  walletPublicKey: string
) {
  const accountIndex = tx.transaction.message.accountKeys.findIndex(
    (key) => resolveAccountKey(key) === walletPublicKey
  );
  if (accountIndex === -1) return 0;
  const preSolBalance = tx.meta?.preBalances?.[accountIndex];
  const postSolBalance = tx.meta?.postBalances?.[accountIndex];
  if (preSolBalance === undefined || postSolBalance === undefined) return 0;
  return (postSolBalance - preSolBalance) / LAMPORTS_PER_SOL;
}

function getWrappedSolDiffForOwner(
  tx: ParsedTransactionWithMeta,
  walletPublicKey: string
) {
  if (!tx.meta) return 0;
  const preBalance = sumTokenBalances(
    tx.meta.preTokenBalances,
    walletPublicKey,
    WRAPPED_SOL_MINT
  );
  const postBalance = sumTokenBalances(
    tx.meta.postTokenBalances,
    walletPublicKey,
    WRAPPED_SOL_MINT
  );
  return postBalance - preBalance;
}

function numbersDiffer(a: number, b: number, epsilon: number) {
  return Math.abs(a - b) > epsilon;
}

function takeMatchingTradeEvent(
  events: PumpTradeEvent[],
  owner: string,
  isBuy: boolean
) {
  const index = events.findIndex(
    (event) => event.user === owner && event.isBuy === isBuy
  );
  if (index < 0) return null;
  const [event] = events.splice(index, 1);
  return event ?? null;
}

function emptyTransactionMetrics(): TokenTransactionMetrics {
  return {
    buys: { total: 0, owned: 0, external: 0 },
    sells: { total: 0, owned: 0, external: 0 },
    volume: { total: 0, owned: 0, external: 0 },
    traders: { total: 0, owned: 0, external: 0 },
  };
}

async function getTokenTransactionMetrics(
  where: Prisma.TokenTransactionWhereInput
): Promise<TokenTransactionMetrics> {
  const metrics = emptyTransactionMetrics();
  const [byTypeAndOwnership, traderRows] = await Promise.all([
    prisma.tokenTransaction.groupBy({
      by: ["transactionType", "isOwned"],
      where: {
        ...where,
        transactionType: { in: ["BUY", "SELL"] },
      },
      _sum: { solAmount: true },
      _count: { _all: true },
    }),
    prisma.tokenTransaction.groupBy({
      by: ["walletPublicKey", "isOwned"],
      where,
      _count: { _all: true },
    }),
  ]);

  for (const row of byTypeAndOwnership) {
    const bucket =
      row.transactionType === "BUY"
        ? metrics.buys
        : row.transactionType === "SELL"
          ? metrics.sells
          : null;
    if (!bucket) continue;

    const count = row._count._all;
    const volume = Number(row._sum.solAmount ?? 0);
    bucket.total += count;
    metrics.volume.total += volume;

    if (row.isOwned) {
      bucket.owned += count;
      metrics.volume.owned += volume;
    } else {
      bucket.external += count;
      metrics.volume.external += volume;
    }
  }

  for (const row of traderRows) {
    metrics.traders.total += 1;
    if (row.isOwned) {
      metrics.traders.owned += 1;
    } else {
      metrics.traders.external += 1;
    }
  }

  return metrics;
}

async function getAllowedWallets(
  tokenPublicKey: string,
  userId: string,
  walletPublicKeys?: string[]
) {
  const token = await prisma.token.findFirst({
    where: { publicKey: tokenPublicKey, userId },
    select: { publicKey: true, userId: true },
  });

  if (!token) {
    throw new AppError("Token not found", 404);
  }

  const [operationalWallets, devWallet, user] = await Promise.all([
    prisma.wallet.findMany({
      where: {
        tokenPublicKey,
        type: { in: ["BUNDLER", "VOLUME", "BUYER", "DISTRIBUTION"] },
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
  ]);

  const allWallets: WalletRecord[] = [
    ...(user?.mainWallet ? [user.mainWallet] : []),
    ...(devWallet?.wallet ? [devWallet.wallet] : []),
    ...operationalWallets,
  ];

  const walletSet = walletPublicKeys?.length ? new Set(walletPublicKeys) : null;
  const filteredWallets = walletSet
    ? allWallets.filter((wallet) => walletSet.has(wallet.publicKey))
    : allWallets;

  return { token, wallets: filteredWallets };
}

async function getTokenByPublicKeyWithOwner(tokenPublicKey: string) {
  const token = await prisma.token.findUnique({
    where: { publicKey: tokenPublicKey },
    select: { publicKey: true, userId: true },
  });
  if (!token) {
    throw new AppError("Token not found", 404);
  }
  return token;
}

async function getTokenSourceSignatures(
  tokenPublicKey: string,
  connection: ReturnType<typeof getSolanaConnection>,
  knownSignatures: Set<string>
) {
  const signatureLimit = 120;
  const knownStreakStop = 25;
  const sourceConcurrency = 2;
  const rpcTimeoutMs = 10_000;
  const mint = new PublicKey(tokenPublicKey);
  const { bondingCurve } = derivePumpAddresses(mint);
  const sources = [tokenPublicKey, bondingCurve.toBase58()];
  const orderedUnique: string[] = [];
  const seen = new Set<string>();
  const sourceResults = await mapWithConcurrency(
    sources,
    sourceConcurrency,
    async (source) => {
      const response = await Promise.race([
        retryRpc(() =>
          connection.getSignaturesForAddress(new PublicKey(source), {
            limit: signatureLimit,
          })
        ),
        new Promise<null>((resolve) => {
          setTimeout(() => resolve(null), rpcTimeoutMs);
        }),
      ]);
      return { signatures: response?.map((info) => info.signature) ?? [] };
    }
  );

  for (const { signatures } of sourceResults) {

    let knownStreak = 0;
    for (const signature of signatures) {
      if (knownSignatures.has(signature)) {
        knownStreak += 1;
        if (knownStreak >= knownStreakStop) {
          break;
        }
        continue;
      }
      knownStreak = 0;
      if (seen.has(signature)) continue;
      seen.add(signature);
      orderedUnique.push(signature);
    }
  }

  return orderedUnique;
}

function parseTransactionForTokenOwners(
  signature: string,
  tx: ParsedTransactionWithMeta | null,
  tokenPublicKey: string
): ParsedTransactionResult[] {
  if (!tx || !tx.meta) {
    return [];
  }

  const preByOwner = sumTokenBalancesByOwner(
    tx.meta.preTokenBalances,
    tokenPublicKey
  );
  const postByOwner = sumTokenBalancesByOwner(
    tx.meta.postTokenBalances,
    tokenPublicKey
  );

  const owners = new Set<string>([
    ...Array.from(preByOwner.keys()),
    ...Array.from(postByOwner.keys()),
  ]);

  if (owners.size === 0) {
    return [];
  }

  const isCreate = tx.meta.logMessages?.some(
    (log) =>
      log.includes("Instruction: InitializeMint") ||
      log.includes("Instruction: Create")
  );

  const results: ParsedTransactionResult[] = [];
  const txSlot = tx.slot ? BigInt(tx.slot) : null;
  const txBlockTime = tx.blockTime ? new Date(tx.blockTime * 1000) : null;
  const txFee = (tx.meta?.fee ?? 0) / LAMPORTS_PER_SOL;
  const txFailed = Boolean(tx.meta?.err);
  const tokenDecimals = getTokenDecimals(tx, tokenPublicKey);
  const tradeEvents = parsePumpTradeEvents(tx, tokenPublicKey, tokenDecimals);

  owners.forEach((owner) => {
    const preAmount = preByOwner.get(owner) ?? 0;
    const postAmount = postByOwner.get(owner) ?? 0;
    const tokenDiff = postAmount - preAmount;
    if (tokenDiff === 0) return;

    const matchedTrade = takeMatchingTradeEvent(
      tradeEvents,
      owner,
      tokenDiff > 0
    );
    if (matchedTrade) {
      const transactionType = matchedTrade.isBuy ? "BUY" : "SELL";
      const solAmount = matchedTrade.solAmount;
      const tokenAmount = matchedTrade.tokenAmount;
      results.push({
        walletPublicKey: owner,
        transactionType,
        status: txFailed ? "FAILED" : "CONFIRMED",
        transactionSignature: signature,
        solAmount,
        tokenAmount,
        pricePerToken: tokenAmount ? solAmount / tokenAmount : 0,
        slippageBps: 0,
        feeAmount: txFee,
        slot: txSlot,
        blockTime: txBlockTime,
        amountSource: "PUMP_EVENT",
      });
      return;
    }

    const systemSolDiff = getSystemSolDiff(tx, owner);
    const wrappedSolDiff = getWrappedSolDiffForOwner(tx, owner);
    const solDiff =
      Math.abs(wrappedSolDiff) > Math.abs(systemSolDiff)
        ? wrappedSolDiff
        : systemSolDiff;

    if (tokenDiff > 0) {
      const solAmount = Math.max(0, -solDiff);
      const tokenAmount = tokenDiff;
      results.push({
        walletPublicKey: owner,
        transactionType: isCreate ? "CREATE" : "BUY",
        status: txFailed ? "FAILED" : "CONFIRMED",
        transactionSignature: signature,
        solAmount,
        tokenAmount,
        pricePerToken: tokenAmount ? solAmount / tokenAmount : 0,
        slippageBps: 0,
        feeAmount: txFee,
        slot: txSlot,
        blockTime: txBlockTime,
        amountSource: "BALANCE_DELTA",
      });
      return;
    }

    const solAmount = Math.max(0, solDiff);
    const tokenAmount = Math.abs(tokenDiff);
    results.push({
      walletPublicKey: owner,
      transactionType: "SELL",
      status: txFailed ? "FAILED" : "CONFIRMED",
      transactionSignature: signature,
      solAmount,
      tokenAmount,
      pricePerToken: tokenAmount ? solAmount / tokenAmount : 0,
      slippageBps: 0,
      feeAmount: txFee,
      slot: txSlot,
      blockTime: txBlockTime,
      amountSource: "BALANCE_DELTA",
    });
  });

  return results;
}

export const transactionService = {
  async listByToken(input: ListTransactionsByTokenInput, userId: string) {
    const token = await prisma.token.findFirst({
      where: { publicKey: input.tokenPublicKey, userId },
      select: { publicKey: true },
    });

    if (!token) {
      throw new AppError("Token not found", 404);
    }

    const mint = new PublicKey(token.publicKey);
    const { bondingCurve } = derivePumpAddresses(mint);
    const bondingCurvePublicKey = bondingCurve.toBase58();
    const walletFilter = input.walletPublicKey
      ? Prisma.sql`AND tt."walletPublicKey" = ${input.walletPublicKey}`
      : Prisma.empty;
    const groupBySignature = input.groupBySignature ?? true;
    const page = input.page ?? 1;
    const pageSize = input.pageSize ?? 25;
    const skip = (page - 1) * pageSize;
    const take = pageSize;
    const flatWhere: Prisma.TokenTransactionWhereInput = {
      tokenPublicKey: token.publicKey,
      AND: [
        { walletPublicKey: { not: bondingCurvePublicKey } },
        ...(input.walletPublicKey
          ? [{ walletPublicKey: input.walletPublicKey }]
          : []),
      ],
    };
    const { rows, totalCount } = groupBySignature
      ? await (async () => {
          const [groupedRows, groupedCountRows] = await Promise.all([
            prisma.$queryRaw<TokenTransactionListRow[]>(
              Prisma.sql`
                SELECT *
                FROM (
                  SELECT DISTINCT ON (tt."transactionSignature")
                    tt."id",
                    tt."walletPublicKey",
                    tt."walletType",
                    tt."isOwned",
                    tt."transactionType",
                    tt."status",
                    tt."transactionSignature",
                    tt."solAmount"::double precision AS "solAmount",
                    tt."tokenAmount"::double precision AS "tokenAmount",
                    tt."pricePerToken"::double precision AS "pricePerToken",
                    tt."slippageBps",
                    tt."feeAmount"::double precision AS "feeAmount",
                    tt."slot",
                    tt."blockTime",
                    tt."createdAt",
                    tt."updatedAt"
                  FROM "TokenTransaction" tt
                  WHERE tt."tokenPublicKey" = ${token.publicKey}
                    ${walletFilter}
                  ORDER BY
                    tt."transactionSignature",
                    CASE WHEN tt."walletPublicKey" = ${bondingCurvePublicKey} THEN 1 ELSE 0 END ASC,
                    CASE WHEN tt."walletType" IS NULL THEN 1 ELSE 0 END ASC,
                    tt."slot" DESC NULLS LAST,
                    COALESCE(tt."blockTime", tt."createdAt") DESC
                ) grouped
                ORDER BY grouped."slot" DESC NULLS LAST, COALESCE(grouped."blockTime", grouped."createdAt") DESC
                LIMIT ${take}
                OFFSET ${skip}
              `
            ),
            prisma.$queryRaw<Array<{ count: bigint | number }>>(
              Prisma.sql`
                SELECT COUNT(DISTINCT tt."transactionSignature") AS "count"
                FROM "TokenTransaction" tt
                WHERE tt."tokenPublicKey" = ${token.publicKey}
                  ${walletFilter}
              `
            ),
          ]);

          return {
            rows: groupedRows,
            totalCount: Number(groupedCountRows[0]?.count ?? 0),
          };
        })()
      : await (async () => {
          const [flatRows, count] = await Promise.all([
            prisma.tokenTransaction.findMany({
              where: flatWhere,
              select: {
                id: true,
                walletPublicKey: true,
                walletType: true,
                isOwned: true,
                transactionType: true,
                status: true,
                transactionSignature: true,
                solAmount: true,
                tokenAmount: true,
                pricePerToken: true,
                slippageBps: true,
                feeAmount: true,
                slot: true,
                blockTime: true,
                createdAt: true,
                updatedAt: true,
              },
              orderBy: [
                { slot: { sort: "desc", nulls: "last" } },
                { blockTime: "desc" },
                { createdAt: "desc" },
              ],
              skip,
              take,
            }),
            prisma.tokenTransaction.count({ where: flatWhere }),
          ]);

          return {
            rows: flatRows.map((row) => ({
              ...row,
              solAmount: Number(row.solAmount),
              tokenAmount: Number(row.tokenAmount),
              pricePerToken: Number(row.pricePerToken),
              feeAmount: Number(row.feeAmount),
            })),
            totalCount: count,
          };
        })();
    const metrics = await getTokenTransactionMetrics(flatWhere);

    const items = rows.map((row) => ({
      ...row,
      wallet: {
        publicKey: row.walletPublicKey,
        type: row.walletType,
      },
    }));

    return { items, totalCount, metrics };
  },

  async ingestTokenSignatures(input: {
    tokenPublicKey: string;
    signatures: string[];
    userId?: string;
    walletPublicKeys?: string[];
    requireAllParsed?: boolean;
  }) {
    const token = input.userId
      ? await prisma.token.findFirst({
          where: { publicKey: input.tokenPublicKey, userId: input.userId },
          select: { publicKey: true, userId: true },
        })
      : await getTokenByPublicKeyWithOwner(input.tokenPublicKey);

    if (!token) {
      throw new AppError("Token not found", 404);
    }

    const connection = getSolanaConnection();
    const signatures = Array.from(new Set(input.signatures));
    if (signatures.length === 0) {
      await refreshCacheService.touch({
        userId: token.userId,
        tokenPublicKey: token.publicKey,
        scope: "TRANSACTIONS",
      });
      return [];
    }

    const parsedBySignature = new Map<string, ParsedTransactionWithMeta | null>();
    let pendingSignatures = [...signatures];
    const maxAttempts = PARSE_RETRY_DELAYS_MS.length + 1;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const batchSize = 10;
      const batches: string[][] = [];
      for (let i = 0; i < pendingSignatures.length; i += batchSize) {
        batches.push(pendingSignatures.slice(i, i + batchSize));
      }

      const batchResults = await mapWithConcurrency(batches, 3, async (batch) => {
        return retryRpcWithTimeout(
          () =>
            connection.getParsedTransactions(batch, {
              maxSupportedTransactionVersion: 0,
            }),
          rpcConfig.tuning.parseTimeoutMs
        );
      });

      batches.forEach((batch, batchIndex) => {
        const parsedBatch = batchResults[batchIndex];
        if (!parsedBatch) return;
        parsedBatch.forEach((parsed, index) => {
          const signature = batch[index];
          if (signature) {
            parsedBySignature.set(signature, parsed);
          }
        });
      });

      pendingSignatures = pendingSignatures.filter((signature) => {
        const parsed = parsedBySignature.get(signature);
        return parsed === null || parsed === undefined;
      });

      if (pendingSignatures.length === 0) {
        break;
      }

      const delayMs = PARSE_RETRY_DELAYS_MS[attempt - 1];
      if (delayMs) {
        await sleep(delayMs);
      }
    }

    const { wallets } = await getAllowedWallets(
      token.publicKey,
      token.userId,
      input.walletPublicKeys
    );
    const ownedWalletsByKey = new Map(
      wallets.map((wallet) => [wallet.publicKey, wallet.type] as const)
    );

    const parsedTransactions: ParsedTransactionResult[] = [];
    signatures.forEach((signature) => {
      const parsed = parsedBySignature.get(signature) ?? null;
      if (!parsed) return;
      parsedTransactions.push(
        ...parseTransactionForTokenOwners(signature, parsed, token.publicKey)
      );
    });

    if (parsedTransactions.length === 0) {
      await refreshCacheService.touch({
        userId: token.userId,
        tokenPublicKey: token.publicKey,
        scope: "TRANSACTIONS",
      });
      return [];
    }

    const parsedByKey = new Map<string, ParsedTransactionResult>();
    parsedTransactions.forEach((transaction) => {
      const key = `${transaction.walletPublicKey}:${transaction.transactionSignature}:${transaction.transactionType}`;
      if (!parsedByKey.has(key)) {
        parsedByKey.set(key, transaction);
      }
    });

    const parsedRows = Array.from(parsedByKey.values());
    const parsedSignatures = Array.from(
      new Set(parsedRows.map((tx) => tx.transactionSignature))
    );
    const parsedWallets = Array.from(
      new Set(parsedRows.map((tx) => tx.walletPublicKey))
    );

    const existing = await prisma.tokenTransaction.findMany({
      where: {
        tokenPublicKey: token.publicKey,
        transactionSignature: { in: parsedSignatures },
        walletPublicKey: { in: parsedWallets },
      },
      select: {
        id: true,
        transactionSignature: true,
        walletPublicKey: true,
        transactionType: true,
        solAmount: true,
        tokenAmount: true,
        pricePerToken: true,
      },
    });

    const existingByKey = new Map(
      existing.map((transaction) => [
        `${transaction.walletPublicKey}:${transaction.transactionSignature}:${transaction.transactionType}`,
        transaction,
      ])
    );

    const newTransactions = Array.from(parsedByKey.entries())
      .filter(([key]) => !existingByKey.has(key))
      .map(([, transaction]) => transaction);

    const updates = Array.from(parsedByKey.entries())
      .map(([key, transaction]) => {
        const existingTx = existingByKey.get(key);
        if (!existingTx) return null;
        const existingPrice = Number(existingTx.pricePerToken ?? 0);
        const existingSol = Number(existingTx.solAmount ?? 0);
        const existingToken = Number(existingTx.tokenAmount ?? 0);
        const hasPumpEventCorrection =
          transaction.amountSource === "PUMP_EVENT" &&
          (numbersDiffer(existingSol, transaction.solAmount, 0.5 / LAMPORTS_PER_SOL) ||
            numbersDiffer(existingToken, transaction.tokenAmount, 0.000001) ||
            numbersDiffer(existingPrice, transaction.pricePerToken, 0.000000000001));
        const shouldUpdate =
          (existingPrice === 0 && transaction.pricePerToken > 0) ||
          (existingSol === 0 && transaction.solAmount > 0) ||
          (existingToken === 0 && transaction.tokenAmount > 0) ||
          hasPumpEventCorrection;
        if (!shouldUpdate) return null;
        return {
          id: existingTx.id,
          data: {
            solAmount: transaction.solAmount,
            tokenAmount: transaction.tokenAmount,
            pricePerToken: transaction.pricePerToken,
            feeAmount: transaction.feeAmount,
            slot: transaction.slot,
            blockTime: transaction.blockTime,
            status: transaction.status,
          },
        };
      })
      .filter(
        (
          update
        ): update is {
          id: string;
          data: {
            solAmount: number;
            tokenAmount: number;
            pricePerToken: number;
            feeAmount: number;
            slot: bigint | null;
            blockTime: Date | null;
            status: "CONFIRMED" | "FAILED";
          };
        } => Boolean(update)
      );

    if (newTransactions.length > 0) {
      await prisma.tokenTransaction.createMany({
        skipDuplicates: true,
        data: newTransactions.map((transaction) => ({
          walletPublicKey: transaction.walletPublicKey,
          walletRefPublicKey: ownedWalletsByKey.has(transaction.walletPublicKey)
            ? transaction.walletPublicKey
            : null,
          tokenPublicKey: token.publicKey,
          walletType:
            ownedWalletsByKey.get(transaction.walletPublicKey) ?? null,
          isOwned: ownedWalletsByKey.has(transaction.walletPublicKey),
          transactionType: transaction.transactionType,
          status: transaction.status,
          transactionSignature: transaction.transactionSignature,
          solAmount: transaction.solAmount,
          tokenAmount: transaction.tokenAmount,
          pricePerToken: transaction.pricePerToken,
          slippageBps: transaction.slippageBps,
          feeAmount: transaction.feeAmount,
          slot: transaction.slot,
          blockTime: transaction.blockTime,
        })),
      });
    }

    if (updates.length > 0) {
      for (
        let i = 0;
        i < updates.length;
        i += TOKEN_TRANSACTION_UPDATE_BATCH_SIZE
      ) {
        const chunk = updates.slice(i, i + TOKEN_TRANSACTION_UPDATE_BATCH_SIZE);
        await prisma.$transaction(
          chunk.map((update) =>
            prisma.tokenTransaction.update({
              where: { id: update.id },
              data: update.data,
            })
          )
        );
      }
    }

    await refreshCacheService.touch({
      userId: token.userId,
      tokenPublicKey: token.publicKey,
      scope: "TRANSACTIONS",
    });

    if (input.requireAllParsed && pendingSignatures.length > 0) {
      throw new PendingSignatureIngestionError(pendingSignatures);
    }

    return newTransactions;
  },
  async refreshByToken(input: RefreshTransactionsByTokenInput, userId: string) {
    const token = await prisma.token.findFirst({
      where: { publicKey: input.tokenPublicKey, userId },
      select: { publicKey: true, userId: true },
    });
    if (!token) {
      throw new AppError("Token not found", 404);
    }

    const connection = getSolanaConnection();

    const [latestRows, staleRows] = await Promise.all([
      prisma.tokenTransaction.findMany({
        where: { tokenPublicKey: token.publicKey },
        select: { transactionSignature: true },
        orderBy: { createdAt: "desc" },
        take: 300,
      }),
      prisma.tokenTransaction.findMany({
        where: {
          tokenPublicKey: token.publicKey,
          OR: [{ pricePerToken: 0 }, { solAmount: 0 }],
        },
        select: { transactionSignature: true },
        orderBy: { updatedAt: "desc" },
        take: 200,
      }),
    ]);
    const knownSignatures = new Set(
      latestRows.map((row) => row.transactionSignature)
    );
    staleRows.forEach((row) => knownSignatures.add(row.transactionSignature));

    const signatures = await getTokenSourceSignatures(
      token.publicKey,
      connection,
      knownSignatures
    );
    const signatureSet = new Set(signatures);
    staleRows.forEach((row) => {
      if (!signatureSet.has(row.transactionSignature)) {
        signatures.push(row.transactionSignature);
        signatureSet.add(row.transactionSignature);
      }
    });

    return await this.ingestTokenSignatures({
      tokenPublicKey: token.publicKey,
      signatures,
      userId,
      walletPublicKeys: input.walletPublicKeys,
    });
  },
};

export type TransactionItem = Awaited<
  ReturnType<typeof transactionService.listByToken>
>["items"][number];
