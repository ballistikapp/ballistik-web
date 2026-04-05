import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import type {
  AppTransactionType,
  AppTransactionSource,
  TransactionStatus,
  Prisma,
} from "@/lib/generated/prisma/client";

const log = logger.child({ service: "app-transaction" });

type CreateAppTransactionInput = {
  userId: string;
  type: AppTransactionType;
  source: AppTransactionSource;
  tokenPublicKey?: string | null;
  walletPublicKey?: string | null;
  fromAddress?: string | null;
  toAddress?: string | null;
  solAmount?: number | null;
  tokenAmount?: number | null;
  pricePerToken?: number | null;
  jitoTipLamports?: number | null;
  bundleId?: string | null;
  referenceId?: string | null;
  description?: string | null;
  transactionSignature?: string | null;
};

type ConfirmInput = {
  signature: string;
  blockTime?: Date | null;
};

type FailInput = {
  signature?: string | null;
  errorMessage: string;
};

type ListFilters = {
  userId: string;
  tokenPublicKey?: string;
  source?: AppTransactionSource;
  type?: AppTransactionType;
  status?: TransactionStatus;
  search?: string;
  page?: number;
  pageSize?: number;
};

function truncateAddress(address: string): string {
  if (address.length <= 8) return address;
  return `${address.slice(0, 4)}...${address.slice(-4)}`;
}

function formatSol(amount: number): string {
  return amount % 1 === 0 ? amount.toString() : amount.toFixed(4);
}

function formatTokenAmount(amount: number): string {
  if (amount >= 1_000_000) return `${(amount / 1_000_000).toFixed(2)}M`;
  if (amount >= 1_000) return `${(amount / 1_000).toFixed(1)}K`;
  return amount.toFixed(2);
}

export function generateDescription(
  type: AppTransactionType,
  opts: {
    solAmount?: number | null;
    tokenAmount?: number | null;
    toAddress?: string | null;
    fromAddress?: string | null;
    walletPublicKey?: string | null;
  }
): string {
  const sol = opts.solAmount ? formatSol(opts.solAmount) : null;
  const tokens = opts.tokenAmount ? formatTokenAmount(opts.tokenAmount) : null;
  const to = opts.toAddress ? truncateAddress(opts.toAddress) : null;
  const from = opts.fromAddress ? truncateAddress(opts.fromAddress) : null;
  const wallet = opts.walletPublicKey
    ? truncateAddress(opts.walletPublicKey)
    : null;

  switch (type) {
    case "TRADE_BUY":
      return tokens && sol
        ? `Buy ${tokens} tokens for ${sol} SOL`
        : `Buy tokens${sol ? ` for ${sol} SOL` : ""}`;
    case "TRADE_SELL":
      return tokens && sol
        ? `Sell ${tokens} tokens for ${sol} SOL`
        : `Sell tokens${sol ? ` for ${sol} SOL` : ""}`;
    case "TRADE_CREATE":
      return "Create token on pump.fun";
    case "TRANSFER_FUND":
      return `Fund wallet ${to ?? wallet ?? "unknown"} with ${sol ?? "?"} SOL`;
    case "TRANSFER_RETURN":
      return `Return ${sol ?? "?"} SOL from ${from ?? wallet ?? "unknown"} to main`;
    case "TRANSFER_RECLAIM":
      return `Reclaim ${sol ?? "?"} SOL from ${from ?? wallet ?? "unknown"}`;
    case "TRANSFER_WITHDRAW":
      return `Withdraw ${sol ?? "?"} SOL to ${to ?? "unknown"}`;
    case "FEE_USAGE":
      return `Platform fee: ${sol ?? "?"} SOL`;
    case "FEE_PRO":
      return `Pro subscription: ${sol ?? "?"} SOL`;
    case "TOKEN_DISTRIBUTE":
      return `Distribute tokens to ${to ?? wallet ?? "unknown"}`;
    case "TOKEN_CONSOLIDATE":
      return `Consolidate tokens from ${from ?? wallet ?? "unknown"}`;
    case "ACCOUNT_ATA_CREATE":
      return `Create token account for ${to ?? wallet ?? "unknown"}`;
    case "ACCOUNT_ATA_CLOSE":
      return `Close token account for ${from ?? wallet ?? "unknown"}`;
    default:
      return "Transaction";
  }
}

export const appTransactionService = {
  async create(input: CreateAppTransactionInput) {
    const description =
      input.description ??
      generateDescription(input.type, {
        solAmount: input.solAmount,
        tokenAmount: input.tokenAmount,
        toAddress: input.toAddress,
        fromAddress: input.fromAddress,
        walletPublicKey: input.walletPublicKey,
      });

    return await prisma.appTransaction.create({
      data: {
        userId: input.userId,
        type: input.type,
        source: input.source,
        status: "PENDING",
        tokenPublicKey: input.tokenPublicKey ?? undefined,
        walletPublicKey: input.walletPublicKey ?? undefined,
        fromAddress: input.fromAddress ?? undefined,
        toAddress: input.toAddress ?? undefined,
        solAmount: input.solAmount ?? undefined,
        tokenAmount: input.tokenAmount ?? undefined,
        pricePerToken: input.pricePerToken ?? undefined,
        jitoTipLamports: input.jitoTipLamports ?? undefined,
        bundleId: input.bundleId ?? undefined,
        referenceId: input.referenceId ?? undefined,
        transactionSignature: input.transactionSignature ?? undefined,
        description,
      },
    });
  },

  async createMany(inputs: CreateAppTransactionInput[]) {
    const data = inputs.map((input) => ({
      userId: input.userId,
      type: input.type,
      source: input.source,
      status: "PENDING" as TransactionStatus,
      tokenPublicKey: input.tokenPublicKey ?? undefined,
      walletPublicKey: input.walletPublicKey ?? undefined,
      fromAddress: input.fromAddress ?? undefined,
      toAddress: input.toAddress ?? undefined,
      solAmount: input.solAmount ?? undefined,
      tokenAmount: input.tokenAmount ?? undefined,
      pricePerToken: input.pricePerToken ?? undefined,
      jitoTipLamports: input.jitoTipLamports ?? undefined,
      bundleId: input.bundleId ?? undefined,
      referenceId: input.referenceId ?? undefined,
      transactionSignature: input.transactionSignature ?? undefined,
      description:
        input.description ??
        generateDescription(input.type, {
          solAmount: input.solAmount,
          tokenAmount: input.tokenAmount,
          toAddress: input.toAddress,
          fromAddress: input.fromAddress,
          walletPublicKey: input.walletPublicKey,
        }),
    }));

    await prisma.appTransaction.createMany({ data });

    return await prisma.appTransaction.findMany({
      where: {
        userId: inputs[0].userId,
        status: "PENDING",
      },
      orderBy: { createdAt: "desc" },
      take: inputs.length,
    });
  },

  async confirm(id: string, input: ConfirmInput) {
    return await prisma.appTransaction.update({
      where: { id },
      data: {
        status: "CONFIRMED",
        transactionSignature: input.signature,
        blockTime: input.blockTime ?? undefined,
      },
    });
  },

  async confirmMany(ids: string[], input: ConfirmInput) {
    return await prisma.appTransaction.updateMany({
      where: { id: { in: ids } },
      data: {
        status: "CONFIRMED",
        transactionSignature: input.signature,
        blockTime: input.blockTime ?? undefined,
      },
    });
  },

  async fail(id: string, input: FailInput) {
    return await prisma.appTransaction.update({
      where: { id },
      data: {
        status: "FAILED",
        transactionSignature: input.signature ?? undefined,
        errorMessage: input.errorMessage,
      },
    });
  },

  async failMany(ids: string[], input: FailInput) {
    return await prisma.appTransaction.updateMany({
      where: { id: { in: ids } },
      data: {
        status: "FAILED",
        transactionSignature: input.signature ?? undefined,
        errorMessage: input.errorMessage,
      },
    });
  },

  async list(filters: ListFilters) {
    const page = filters.page ?? 1;
    const pageSize = Math.min(filters.pageSize ?? 25, 100);

    const where: Prisma.AppTransactionWhereInput = {
      userId: filters.userId,
      ...(filters.tokenPublicKey && {
        tokenPublicKey: filters.tokenPublicKey,
      }),
      ...(filters.source && { source: filters.source }),
      ...(filters.type && { type: filters.type }),
      ...(filters.status && { status: filters.status }),
      ...(filters.search && {
        OR: [
          { description: { contains: filters.search, mode: "insensitive" as const } },
          { walletPublicKey: { contains: filters.search, mode: "insensitive" as const } },
          { transactionSignature: { contains: filters.search, mode: "insensitive" as const } },
        ],
      }),
    };

    const [items, totalCount] = await Promise.all([
      prisma.appTransaction.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.appTransaction.count({ where }),
    ]);

    return { items, totalCount };
  },

  async costBreakdown(userId: string, tokenPublicKey: string) {
    const rows = await prisma.appTransaction.groupBy({
      by: ["type", "source"],
      where: {
        userId,
        tokenPublicKey,
        status: "CONFIRMED",
        solAmount: { not: null },
      },
      _sum: { solAmount: true },
      _count: { id: true },
    });

    const byType: Record<string, { solAmount: number; count: number }> = {};
    const bySource: Record<string, { solAmount: number; count: number }> = {};

    for (const row of rows) {
      const sol = Number(row._sum.solAmount ?? 0);
      const count = row._count.id;

      if (!byType[row.type]) byType[row.type] = { solAmount: 0, count: 0 };
      byType[row.type].solAmount += sol;
      byType[row.type].count += count;

      if (!bySource[row.source]) bySource[row.source] = { solAmount: 0, count: 0 };
      bySource[row.source].solAmount += sol;
      bySource[row.source].count += count;
    }

    const totalFees = (byType["FEE_USAGE"]?.solAmount ?? 0) + (byType["FEE_PRO"]?.solAmount ?? 0);
    const totalFunding = (byType["TRANSFER_FUND"]?.solAmount ?? 0);
    const totalReturns = (byType["TRANSFER_RETURN"]?.solAmount ?? 0) + (byType["TRANSFER_RECLAIM"]?.solAmount ?? 0);
    const totalBuys = (byType["TRADE_BUY"]?.solAmount ?? 0);
    const totalSells = (byType["TRADE_SELL"]?.solAmount ?? 0);

    const totalTransactions = rows.reduce((sum, r) => sum + r._count.id, 0);

    return {
      byType,
      bySource,
      summary: {
        totalFees,
        totalFunding,
        totalReturns,
        totalBuys,
        totalSells,
        netPnl: totalSells - totalBuys,
        totalTransactions,
      },
    };
  },
};

// ---------------------------------------------------------------------------
// Tracking utilities
// ---------------------------------------------------------------------------

export type TrackTransactionOpts = Omit<CreateAppTransactionInput, "status">;

export async function trackTransaction<T>(
  opts: TrackTransactionOpts,
  fn: () => Promise<{ signature: string } & T>
): Promise<{ signature: string } & T> {
  let recordId: string | null = null;
  try {
    const record = await appTransactionService.create(opts);
    recordId = record.id;
  } catch (err) {
    log.warn("Failed to create AppTransaction tracking row", {
      err,
      type: opts.type,
      source: opts.source,
    });
  }

  try {
    const result = await fn();
    if (recordId) {
      await appTransactionService
        .confirm(recordId, { signature: result.signature })
        .catch((err) =>
          log.warn("Failed to confirm AppTransaction", { err, recordId })
        );
    }
    return result;
  } catch (error) {
    if (recordId) {
      await appTransactionService
        .fail(recordId, {
          errorMessage:
            error instanceof Error ? error.message : "Unknown error",
        })
        .catch((err) =>
          log.warn("Failed to mark AppTransaction failed", { err, recordId })
        );
    }
    throw error;
  }
}

export type TrackBatchItem = Omit<
  CreateAppTransactionInput,
  "userId" | "source" | "referenceId" | "tokenPublicKey"
>;

export async function trackBatchTransaction<T>(
  common: {
    userId: string;
    source: AppTransactionSource;
    tokenPublicKey?: string | null;
    referenceId?: string | null;
  },
  items: TrackBatchItem[],
  fn: () => Promise<{ signature: string } & T>
): Promise<{ signature: string } & T> {
  let recordIds: string[] = [];
  try {
    const inputs = items.map((item) => ({
      ...item,
      userId: common.userId,
      source: common.source,
      tokenPublicKey: common.tokenPublicKey,
      referenceId: common.referenceId,
    }));
    const records = await appTransactionService.createMany(inputs);
    recordIds = records.map((r) => r.id);
  } catch (err) {
    log.warn("Failed to create AppTransaction batch tracking rows", {
      err,
      source: common.source,
      count: items.length,
    });
  }

  try {
    const result = await fn();
    if (recordIds.length > 0) {
      await appTransactionService
        .confirmMany(recordIds, { signature: result.signature })
        .catch((err) =>
          log.warn("Failed to confirm AppTransaction batch", {
            err,
            count: recordIds.length,
          })
        );
    }
    return result;
  } catch (error) {
    if (recordIds.length > 0) {
      await appTransactionService
        .failMany(recordIds, {
          errorMessage:
            error instanceof Error ? error.message : "Unknown error",
        })
        .catch((err) =>
          log.warn("Failed to mark AppTransaction batch failed", {
            err,
            count: recordIds.length,
          })
        );
    }
    throw error;
  }
}

export type TrackBundleItem = Omit<
  CreateAppTransactionInput,
  "userId" | "source" | "referenceId" | "tokenPublicKey" | "bundleId"
>;

export async function trackBundleTransactions<T>(
  common: {
    userId: string;
    source: AppTransactionSource;
    tokenPublicKey?: string | null;
    referenceId?: string | null;
    bundleId: string;
    jitoTipLamports?: number;
  },
  txItems: TrackBundleItem[][],
  fn: () => Promise<{ signatures: string[] } & T>
): Promise<{ signatures: string[] } & T> {
  const allRecordIds: string[][] = [];
  try {
    for (const items of txItems) {
      const inputs = items.map((item) => ({
        ...item,
        userId: common.userId,
        source: common.source,
        tokenPublicKey: common.tokenPublicKey,
        referenceId: common.referenceId,
        bundleId: common.bundleId,
      }));
      const records = await appTransactionService.createMany(inputs);
      allRecordIds.push(records.map((r) => r.id));
    }

    if (common.jitoTipLamports && allRecordIds.length > 0) {
      const lastGroup = allRecordIds[allRecordIds.length - 1];
      if (lastGroup.length > 0) {
        await prisma.appTransaction
          .update({
            where: { id: lastGroup[lastGroup.length - 1] },
            data: { jitoTipLamports: common.jitoTipLamports },
          })
          .catch(() => {});
      }
    }
  } catch (err) {
    log.warn("Failed to create AppTransaction bundle tracking rows", {
      err,
      source: common.source,
      bundleId: common.bundleId,
    });
  }

  const flatIds = allRecordIds.flat();

  try {
    const result = await fn();

    for (let i = 0; i < allRecordIds.length; i++) {
      const ids = allRecordIds[i];
      const signature = result.signatures[i];
      if (ids.length > 0 && signature) {
        await appTransactionService
          .confirmMany(ids, { signature })
          .catch((err) =>
            log.warn("Failed to confirm AppTransaction bundle tx", {
              err,
              txIndex: i,
            })
          );
      }
    }

    return result;
  } catch (error) {
    if (flatIds.length > 0) {
      await appTransactionService
        .failMany(flatIds, {
          errorMessage:
            error instanceof Error ? error.message : "Unknown error",
        })
        .catch((err) =>
          log.warn("Failed to mark AppTransaction bundle failed", {
            err,
            bundleId: common.bundleId,
          })
        );
    }
    throw error;
  }
}
