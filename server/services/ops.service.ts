import "server-only";

import { prisma, Prisma } from "@/lib/prisma";
import { logger as defaultLogger, type LogContext } from "@/lib/logger";
import { AppError } from "@/server/errors";
import { OPS_WALLET_BALANCE_REFRESH_SELECTION_CAP } from "@/lib/config/ops.config";
import type {
  OpsCreateMarketerInput,
  OpsGetMarketerInput,
  OpsJumpInput,
  OpsJumpResult,
  OpsListLaunchesInput,
  OpsListMarketersInput,
  OpsListTokensInput,
  OpsListUsersInput,
  OpsListWalletAppTransactionsInput,
  OpsListWalletsInput,
  OpsLookupInput,
  OpsRefreshMatchingWalletBalancesInput,
  OpsRefreshWalletBalancesInput,
  OpsRevealPrivateKeyInput,
  OpsUpdateMarketerInput,
} from "@/server/schemas/ops.schema";
import {
  isLegacyPlatformRecord,
  launchPlanEnvelopeV1Schema,
  pumpfunLaunchPlanV1Schema,
  type LaunchOptionsOutcomesV1,
  type PumpfunLaunchPlanV1,
} from "@/server/schemas/launch-platform.schema";
import { appTransactionService } from "@/server/services/app-transaction.service";
import { walletService } from "@/server/services/wallet.service";

type OpsLaunchPlatformIdentity = {
  platform: "PUMPFUN" | null;
  platformVersion: string | null;
  hasPlan: boolean;
  outcomeKind: string | null;
  isLegacy: boolean;
  /** Product policy: legacy records cannot retry/clone. Ops itself has no retry/clone actions. */
  retrySupported: boolean;
  cloneSupported: boolean;
};

type OpsSafePumpfunPlanSummary = {
  money: PumpfunLaunchPlanV1["money"];
  wallets: PumpfunLaunchPlanV1["wallets"];
  allocations: PumpfunLaunchPlanV1["allocations"];
  intendedEffects: PumpfunLaunchPlanV1["intendedEffects"];
  recovery: PumpfunLaunchPlanV1["recovery"];
  optionsOutcomes?: LaunchOptionsOutcomesV1;
};

type OpsJitoDiagnostics = {
  eventCount: number;
  bundleIds: string[];
  endpoints: string[];
  resendCount: number;
  rebuildCount: number;
  lastEventType: string | null;
  lastFailureType: string | null;
  tipLamports: number | null;
  confirmation: {
    foundCount: number | null;
    confirmedCount: number | null;
    failedCount: number | null;
    notFoundCount: number | null;
    createStatus: string | null;
  } | null;
};

const JITO_FAILURE_EVENT_TYPES = new Set([
  "bundle_dropped_by_engine",
  "bundle_send_rejections",
  "bundle_status_check_error",
  "bundle_confirm_timeout",
  "bundle_sequential_simulation",
]);

const NOT_FOUND = "Not found";

type OpsLogger = {
  info: (message: string, context?: LogContext) => void;
};

export type OpsRevealOptions = {
  requestId?: string;
  logger?: OpsLogger;
};

export type OpsOverviewOptions = {
  now?: Date;
};

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

const LAUNCH_STATUSES = [
  "PENDING",
  "RUNNING",
  "CANCELED",
  "FAILED",
  "SUCCEEDED",
] as const;

const TOKEN_STATUSES = ["PENDING", "ACTIVE", "FAILED"] as const;

const WALLET_TYPES = [
  "MAIN_WALLET",
  "DEV",
  "BUNDLER",
  "VOLUME",
  "BUYER",
  "DISTRIBUTION",
] as const;

function throwNotFound(): never {
  throw new AppError(NOT_FOUND, 404);
}

async function requireOperator(callerUserId: string): Promise<void> {
  const caller = await prisma.user.findUnique({
    where: { id: callerUserId },
    select: { isOperator: true },
  });

  if (!caller?.isOperator) {
    throwNotFound();
  }
}

function containsPrivateKeyField(value: unknown): boolean {
  if (value == null || typeof value !== "object") {
    return false;
  }
  if (Array.isArray(value)) {
    return value.some(containsPrivateKeyField);
  }
  return Object.entries(value as Record<string, unknown>).some(
    ([key, nested]) =>
      key === "privateKey" || containsPrivateKeyField(nested)
  );
}

function omitPrivateKeyFields(value: unknown): unknown {
  if (value == null || typeof value !== "object") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(omitPrivateKeyFields);
  }
  const result: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(
    value as Record<string, unknown>
  )) {
    if (key === "privateKey") continue;
    result[key] = omitPrivateKeyFields(nested);
  }
  return result;
}

function projectOpsLaunchPlatformIdentity(launch: {
  platform: "PUMPFUN" | null;
  platformVersion: string | null;
  hasPlan: boolean;
  outcomeKind: string | null;
}): OpsLaunchPlatformIdentity {
  const isLegacy = isLegacyPlatformRecord(launch);
  return {
    platform: launch.platform,
    platformVersion: launch.platformVersion,
    hasPlan: launch.hasPlan,
    outcomeKind: launch.outcomeKind,
    isLegacy,
    // Product eligibility only — Ops does not perform retry/clone.
    retrySupported: !isLegacy,
    cloneSupported: !isLegacy,
  };
}

function projectSafePumpfunPlanSummary(
  plan: unknown
): OpsSafePumpfunPlanSummary | null {
  const envelope = launchPlanEnvelopeV1Schema.safeParse(plan);
  if (envelope.success) {
    const platformPlan = envelope.data.platformPlan;
    return {
      money: platformPlan.money,
      wallets: platformPlan.wallets,
      allocations: platformPlan.allocations,
      intendedEffects: platformPlan.intendedEffects,
      recovery: platformPlan.recovery,
      optionsOutcomes: envelope.data.optionsOutcomes,
    };
  }

  const parsed = pumpfunLaunchPlanV1Schema.safeParse(plan);
  if (!parsed.success) {
    return null;
  }
  return {
    money: parsed.data.money,
    wallets: parsed.data.wallets,
    allocations: parsed.data.allocations,
    intendedEffects: parsed.data.intendedEffects,
    recovery: parsed.data.recovery,
  };
}

function readStringField(
  data: Record<string, unknown>,
  key: string
): string | null {
  const value = data[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function readNumberField(
  data: Record<string, unknown>,
  key: string
): number | null {
  const value = data[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function projectJitoDiagnosticsFromLogs(
  logs: Array<{ data: unknown }>
): OpsJitoDiagnostics {
  const bundleIds: string[] = [];
  const endpoints: string[] = [];
  const seenBundleIds = new Set<string>();
  const seenEndpoints = new Set<string>();
  let eventCount = 0;
  let resendCount = 0;
  let rebuildCount = 0;
  let lastEventType: string | null = null;
  let lastFailureType: string | null = null;
  let tipLamports: number | null = null;
  let confirmation: OpsJitoDiagnostics["confirmation"] = null;

  for (const log of logs) {
    if (log.data == null || typeof log.data !== "object" || Array.isArray(log.data)) {
      continue;
    }
    const data = log.data as Record<string, unknown>;
    if (data.source !== "jito-bundle") {
      continue;
    }
    const eventType = readStringField(data, "eventType");
    if (!eventType) {
      continue;
    }

    eventCount += 1;
    lastEventType = eventType;

    const bundleId = readStringField(data, "bundleId");
    if (bundleId && !seenBundleIds.has(bundleId)) {
      seenBundleIds.add(bundleId);
      bundleIds.push(bundleId);
    }

    const endpoint =
      readStringField(data, "endpoint") ??
      readStringField(data, "bundleEndpoint");
    if (endpoint && !seenEndpoints.has(endpoint)) {
      seenEndpoints.add(endpoint);
      endpoints.push(endpoint);
    }

    const eventTip = readNumberField(data, "tipLamports");
    if (eventTip != null) {
      tipLamports = eventTip;
    }

    const explicitResendCount = readNumberField(data, "resendCount");
    if (explicitResendCount != null) {
      resendCount = Math.max(resendCount, explicitResendCount);
    } else if (eventType === "bundle_resend_triggered") {
      resendCount += 1;
    }

    const explicitRebuildCount = readNumberField(data, "rebuildCount");
    if (explicitRebuildCount != null) {
      rebuildCount = Math.max(rebuildCount, explicitRebuildCount);
    } else if (eventType === "bundle_rebuild_triggered") {
      rebuildCount += 1;
    }

    if (
      eventType === "bundle_confirm_summary" ||
      eventType === "bundle_confirm_timeout"
    ) {
      confirmation = {
        foundCount: readNumberField(data, "foundCount"),
        confirmedCount: readNumberField(data, "confirmedCount"),
        failedCount: readNumberField(data, "failedCount"),
        notFoundCount: readNumberField(data, "notFoundCount"),
        createStatus: readStringField(data, "createStatus"),
      };
    }

    if (JITO_FAILURE_EVENT_TYPES.has(eventType)) {
      if (eventType === "bundle_sequential_simulation") {
        const failed =
          data.status === "ok" &&
          (data.summaryError != null || data.failingTxIndex != null);
        if (failed) {
          lastFailureType = eventType;
        }
      } else {
        lastFailureType = eventType;
      }
    }
  }

  return {
    eventCount,
    bundleIds,
    endpoints,
    resendCount,
    rebuildCount,
    lastEventType,
    lastFailureType,
    tipLamports,
    confirmation,
  };
}

function buildUserSearchWhere(
  search: string | undefined
): Prisma.UserWhereInput | undefined {
  if (!search) return undefined;
  return {
    OR: [
      { id: { contains: search, mode: "insensitive" } },
      { name: { contains: search, mode: "insensitive" } },
      { mainWalletPublicKey: { contains: search, mode: "insensitive" } },
    ],
  };
}

function buildMarketerSearchWhere(
  search: string | undefined
): Prisma.MarketerWhereInput | undefined {
  if (!search) return undefined;
  return {
    OR: [
      { id: { contains: search, mode: "insensitive" } },
      { nickname: { contains: search, mode: "insensitive" } },
      { userId: { contains: search, mode: "insensitive" } },
      { referralCode: { contains: search, mode: "insensitive" } },
      {
        user: {
          OR: [
            { name: { contains: search, mode: "insensitive" } },
            {
              mainWalletPublicKey: {
                contains: search,
                mode: "insensitive",
              },
            },
          ],
        },
      },
    ],
  };
}

function projectMarketer(marketer: {
  id: string;
  userId: string;
  nickname: string;
  feeShareRate: Prisma.Decimal | number | string;
  isEnabled: boolean;
  referralCode: string | null;
  feeCollectorPublicKey: string | null;
  createdAt: Date;
  updatedAt: Date;
  user: {
    id: string;
    name: string;
    mainWalletPublicKey: string;
  };
}) {
  return {
    id: marketer.id,
    userId: marketer.userId,
    userName: marketer.user.name,
    mainWalletPublicKey: marketer.user.mainWalletPublicKey,
    nickname: marketer.nickname,
    feeShareRate: Number(marketer.feeShareRate),
    isEnabled: marketer.isEnabled,
    hasReferralCode: Boolean(marketer.referralCode),
    hasFeeCollector: Boolean(marketer.feeCollectorPublicKey),
    referralCode: marketer.referralCode,
    feeCollectorPublicKey: marketer.feeCollectorPublicKey,
    createdAt: marketer.createdAt,
    updatedAt: marketer.updatedAt,
  };
}

function uniqueConstraintTargets(error: unknown): string[] {
  if (
    !(error instanceof Prisma.PrismaClientKnownRequestError) ||
    error.code !== "P2002"
  ) {
    return [];
  }
  const target = error.meta?.target;
  if (Array.isArray(target)) {
    return target.filter((value): value is string => typeof value === "string");
  }
  if (typeof target === "string") {
    return [target];
  }
  return [];
}

function marketerUniqueConstraintMessage(error: unknown): string | null {
  const targets = uniqueConstraintTargets(error);
  if (targets.length === 0) return null;
  if (targets.includes("userId")) {
    return "User is already a Marketer";
  }
  if (targets.includes("nickname")) {
    return "Nickname already in use";
  }
  return "Marketer already exists";
}

function buildLaunchSearchWhere(
  search: string | undefined
): Prisma.LaunchWhereInput | undefined {
  if (!search) return undefined;

  const or: Prisma.LaunchWhereInput[] = [
    { id: { contains: search, mode: "insensitive" } },
    { tokenPublicKey: { contains: search, mode: "insensitive" } },
    { userId: { contains: search, mode: "insensitive" } },
    { currentStep: { contains: search, mode: "insensitive" } },
  ];

  const needle = search.trim().toLowerCase();
  for (const status of LAUNCH_STATUSES) {
    if (status.toLowerCase().includes(needle)) {
      or.push({ status });
    }
  }

  return { OR: or };
}

function buildTokenSearchWhere(
  search: string | undefined
): Prisma.TokenWhereInput | undefined {
  if (!search) return undefined;

  const or: Prisma.TokenWhereInput[] = [
    { publicKey: { contains: search, mode: "insensitive" } },
    { name: { contains: search, mode: "insensitive" } },
    { symbol: { contains: search, mode: "insensitive" } },
    { userId: { contains: search, mode: "insensitive" } },
  ];

  const needle = search.trim().toLowerCase();
  for (const status of TOKEN_STATUSES) {
    if (status.toLowerCase().includes(needle)) {
      or.push({ status });
    }
  }

  return { OR: or };
}

function buildWalletSearchWhere(
  search: string | undefined
): Prisma.WalletWhereInput | undefined {
  if (!search) return undefined;

  const or: Prisma.WalletWhereInput[] = [
    { publicKey: { contains: search, mode: "insensitive" } },
    { userId: { contains: search, mode: "insensitive" } },
    { tokenPublicKey: { contains: search, mode: "insensitive" } },
  ];

  const needle = search.trim().toLowerCase();
  for (const type of WALLET_TYPES) {
    if (type.toLowerCase().includes(needle)) {
      or.push({ type });
    }
  }

  return { OR: or };
}

function buildWalletListWhere(input: {
  search?: string;
  type?: (typeof WALLET_TYPES)[number];
  isSystemWallet?: boolean;
  userId?: string;
}): Prisma.WalletWhereInput {
  const searchWhere = buildWalletSearchWhere(input.search);
  const ownerWhere: Prisma.WalletWhereInput | undefined = input.userId
    ? {
        OR: [
          { userId: input.userId },
          { mainWalletUser: { id: input.userId } },
        ],
      }
    : undefined;

  return {
    ...(input.type ? { type: input.type } : {}),
    ...(input.isSystemWallet !== undefined
      ? { isSystemWallet: input.isSystemWallet }
      : {}),
    ...(ownerWhere && searchWhere
      ? { AND: [ownerWhere, searchWhere] }
      : (ownerWhere ?? searchWhere ?? {})),
  };
}

const OPS_WALLET_REFRESH_CHUNK_SIZE = 100;

function projectWalletBalanceRefreshResult(result: {
  refreshed: Array<{
    publicKey: string;
    balanceSol: number;
    balanceRefreshedAt: Date;
  }>;
  requestedCount: number;
  refreshedCount: number;
  missingCount: number;
}) {
  const projected = {
    refreshed: result.refreshed.map((wallet) => ({
      publicKey: wallet.publicKey,
      balanceSol: wallet.balanceSol,
      balanceRefreshedAt: wallet.balanceRefreshedAt,
    })),
    requestedCount: result.requestedCount,
    refreshedCount: result.refreshedCount,
    missingCount: result.missingCount,
  };

  if (containsPrivateKeyField(projected)) {
    throw new Error("Ops projection leaked private key fields");
  }

  return projected;
}

export const opsService = {
  async getOverview(callerUserId: string, options: OpsOverviewOptions = {}) {
    await requireOperator(callerUserId);

    const now = options.now ?? new Date();
    const since = new Date(now.getTime() - SEVEN_DAYS_MS);

    const [newUsers7d, launches7d, failedLaunches7d, totalUsers, totalTokens] =
      await Promise.all([
        prisma.user.count({ where: { createdAt: { gte: since } } }),
        prisma.launch.count({ where: { createdAt: { gte: since } } }),
        prisma.launch.count({
          where: { status: "FAILED", createdAt: { gte: since } },
        }),
        prisma.user.count(),
        prisma.token.count(),
      ]);

    return {
      newUsers7d,
      launches7d,
      failedLaunches7d,
      totalUsers,
      totalTokens,
    };
  },

  async listUsers(callerUserId: string, input: OpsListUsersInput) {
    await requireOperator(callerUserId);

    const page = input.page ?? 1;
    const pageSize = input.pageSize ?? 25;
    const sortBy = input.sortBy ?? "createdAt";
    const sortDir = input.sortDir ?? "desc";
    const where = buildUserSearchWhere(input.search);
    const skip = (page - 1) * pageSize;

    const [totalCount, rows] = await Promise.all([
      prisma.user.count({ where }),
      prisma.user.findMany({
        where,
        orderBy: { [sortBy]: sortDir },
        skip,
        take: pageSize,
        select: {
          id: true,
          name: true,
          mainWalletPublicKey: true,
          plan: true,
          paidPlanExpiresAt: true,
          createdAt: true,
        },
      }),
    ]);

    const result = {
      items: rows.map((user) => ({
        id: user.id,
        name: user.name,
        mainWalletPublicKey: user.mainWalletPublicKey,
        plan: user.plan,
        paidPlanExpiresAt: user.paidPlanExpiresAt,
        createdAt: user.createdAt,
      })),
      totalCount,
    };

    if (containsPrivateKeyField(result)) {
      throw new Error("Ops projection leaked private key fields");
    }

    return result;
  },

  async listLaunches(callerUserId: string, input: OpsListLaunchesInput) {
    await requireOperator(callerUserId);

    const page = input.page ?? 1;
    const pageSize = input.pageSize ?? 25;
    const sortBy = input.sortBy ?? "createdAt";
    const sortDir = input.sortDir ?? "desc";
    const searchWhere = buildLaunchSearchWhere(input.search);
    const where: Prisma.LaunchWhereInput = {
      ...(input.userId ? { userId: input.userId } : {}),
      ...(searchWhere ?? {}),
    };
    const skip = (page - 1) * pageSize;

    const [totalCount, rows] = await Promise.all([
      prisma.launch.count({ where }),
      prisma.launch.findMany({
        where,
        orderBy: { [sortBy]: sortDir },
        skip,
        take: pageSize,
        select: {
          id: true,
          status: true,
          progress: true,
          currentStep: true,
          platform: true,
          platformVersion: true,
          planPersistedAt: true,
          outcomeKind: true,
          tokenPublicKey: true,
          userId: true,
          startedAt: true,
          createdAt: true,
          user: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      }),
    ]);

    const result = {
      items: rows.map((launch) => {
        const identity = projectOpsLaunchPlatformIdentity({
          platform: launch.platform,
          platformVersion: launch.platformVersion,
          hasPlan: launch.planPersistedAt != null,
          outcomeKind: launch.outcomeKind,
        });
        return {
          id: launch.id,
          status: launch.status,
          progress: launch.progress,
          currentStep: launch.currentStep,
          tokenPublicKey: launch.tokenPublicKey,
          userId: launch.userId,
          userName: launch.user.name,
          startedAt: launch.startedAt,
          createdAt: launch.createdAt,
          ...identity,
        };
      }),
      totalCount,
    };

    if (containsPrivateKeyField(result)) {
      throw new Error("Ops projection leaked private key fields");
    }

    return result;
  },

  async listTokens(callerUserId: string, input: OpsListTokensInput) {
    await requireOperator(callerUserId);

    const page = input.page ?? 1;
    const pageSize = input.pageSize ?? 25;
    const sortBy = input.sortBy ?? "createdAt";
    const sortDir = input.sortDir ?? "desc";
    const searchWhere = buildTokenSearchWhere(input.search);
    const where: Prisma.TokenWhereInput = {
      ...(input.userId ? { userId: input.userId } : {}),
      ...(searchWhere ?? {}),
    };
    const skip = (page - 1) * pageSize;

    const [totalCount, rows] = await Promise.all([
      prisma.token.count({ where }),
      prisma.token.findMany({
        where,
        orderBy: { [sortBy]: sortDir },
        skip,
        take: pageSize,
        select: {
          publicKey: true,
          name: true,
          symbol: true,
          status: true,
          userId: true,
          createdAt: true,
          user: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      }),
    ]);

    const result = {
      items: rows.map((token) => ({
        publicKey: token.publicKey,
        name: token.name,
        symbol: token.symbol,
        status: token.status,
        userId: token.userId,
        userName: token.user.name,
        createdAt: token.createdAt,
      })),
      totalCount,
    };

    if (containsPrivateKeyField(result)) {
      throw new Error("Ops projection leaked private key fields");
    }

    return result;
  },

  async listWallets(callerUserId: string, input: OpsListWalletsInput) {
    await requireOperator(callerUserId);

    const page = input.page ?? 1;
    const pageSize = input.pageSize ?? 25;
    const sortBy = input.sortBy ?? "createdAt";
    const sortDir = input.sortDir ?? "desc";
    const where = buildWalletListWhere(input);
    const skip = (page - 1) * pageSize;

    const [totalCount, rows] = await Promise.all([
      prisma.wallet.count({ where }),
      prisma.wallet.findMany({
        where,
        orderBy: { [sortBy]: sortDir },
        skip,
        take: pageSize,
        select: {
          publicKey: true,
          type: true,
          userId: true,
          tokenPublicKey: true,
          isSystemWallet: true,
          isImported: true,
          balanceSol: true,
          balanceRefreshedAt: true,
          createdAt: true,
          user: {
            select: {
              id: true,
              name: true,
            },
          },
          mainWalletUser: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      }),
    ]);

    const result = {
      items: rows.map((wallet) => {
        const owner = wallet.user ?? wallet.mainWalletUser;
        return {
          publicKey: wallet.publicKey,
          type: wallet.type,
          userId: wallet.userId ?? owner?.id ?? null,
          userName: owner?.name ?? null,
          tokenPublicKey: wallet.tokenPublicKey,
          isSystemWallet: wallet.isSystemWallet,
          isImported: wallet.isImported,
          balanceSol: Number(wallet.balanceSol ?? 0),
          balanceRefreshedAt: wallet.balanceRefreshedAt,
          createdAt: wallet.createdAt,
        };
      }),
      totalCount,
    };

    if (containsPrivateKeyField(result)) {
      throw new Error("Ops projection leaked private key fields");
    }

    return result;
  },

  async getToken(callerUserId: string, publicKey: string) {
    await requireOperator(callerUserId);

    const token = await prisma.token.findUnique({
      where: { publicKey },
      select: {
        publicKey: true,
        name: true,
        symbol: true,
        description: true,
        imageUrl: true,
        websiteUrl: true,
        twitterUrl: true,
        telegramUrl: true,
        status: true,
        isMayhemMode: true,
        userId: true,
        createdAt: true,
        updatedAt: true,
        user: {
          select: {
            id: true,
            name: true,
            mainWalletPublicKey: true,
          },
        },
      },
    });

    if (!token) {
      throwNotFound();
    }

    const result = {
      publicKey: token.publicKey,
      name: token.name,
      symbol: token.symbol,
      description: token.description,
      imageUrl: token.imageUrl,
      websiteUrl: token.websiteUrl,
      twitterUrl: token.twitterUrl,
      telegramUrl: token.telegramUrl,
      status: token.status,
      isMayhemMode: token.isMayhemMode,
      userId: token.userId,
      userName: token.user.name,
      userMainWalletPublicKey: token.user.mainWalletPublicKey,
      createdAt: token.createdAt,
      updatedAt: token.updatedAt,
    };

    if (containsPrivateKeyField(result)) {
      throw new Error("Ops projection leaked private key fields");
    }

    return result;
  },

  async getWallet(callerUserId: string, publicKey: string) {
    await requireOperator(callerUserId);

    const wallet = await prisma.wallet.findUnique({
      where: { publicKey },
      select: {
        publicKey: true,
        type: true,
        userId: true,
        tokenPublicKey: true,
        balanceSol: true,
        balanceRefreshedAt: true,
        isImported: true,
        isSystemWallet: true,
        createdAt: true,
        updatedAt: true,
        user: {
          select: {
            id: true,
            name: true,
          },
        },
        mainWalletUser: {
          select: {
            id: true,
            name: true,
          },
        },
        token: {
          select: {
            publicKey: true,
            name: true,
            symbol: true,
          },
        },
      },
    });

    if (!wallet) {
      throwNotFound();
    }

    const owner = wallet.user ?? wallet.mainWalletUser;
    const result = {
      publicKey: wallet.publicKey,
      type: wallet.type,
      userId: wallet.userId ?? owner?.id ?? null,
      userName: owner?.name ?? null,
      tokenPublicKey: wallet.tokenPublicKey,
      tokenName: wallet.token?.name ?? null,
      tokenSymbol: wallet.token?.symbol ?? null,
      balanceSol: Number(wallet.balanceSol ?? 0),
      balanceRefreshedAt: wallet.balanceRefreshedAt,
      isImported: wallet.isImported,
      isSystemWallet: wallet.isSystemWallet,
      createdAt: wallet.createdAt,
      updatedAt: wallet.updatedAt,
    };

    if (containsPrivateKeyField(result)) {
      throw new Error("Ops projection leaked private key fields");
    }

    return result;
  },

  async listWalletAppTransactions(
    callerUserId: string,
    input: OpsListWalletAppTransactionsInput
  ) {
    await requireOperator(callerUserId);

    const wallet = await prisma.wallet.findUnique({
      where: { publicKey: input.walletPublicKey },
      select: { publicKey: true },
    });

    if (!wallet) {
      throwNotFound();
    }

    return await appTransactionService.listByWallet({
      walletPublicKey: input.walletPublicKey,
      page: input.page,
      pageSize: input.pageSize,
    });
  },

  async refreshWalletBalances(
    callerUserId: string,
    input: OpsRefreshWalletBalancesInput
  ) {
    await requireOperator(callerUserId);

    if (input.publicKeys.length > OPS_WALLET_BALANCE_REFRESH_SELECTION_CAP) {
      throw new AppError(
        `Cannot refresh more than ${OPS_WALLET_BALANCE_REFRESH_SELECTION_CAP} selected Wallets at once`,
        400
      );
    }

    const result = await walletService.refreshBalancesByPublicKeys(
      input.publicKeys
    );
    return projectWalletBalanceRefreshResult(result);
  },

  async refreshMatchingWalletBalances(
    callerUserId: string,
    input: OpsRefreshMatchingWalletBalancesInput
  ) {
    await requireOperator(callerUserId);

    const where = buildWalletListWhere(input);
    let skip = 0;
    let requestedCount = 0;
    let refreshedCount = 0;
    let missingCount = 0;

    for (;;) {
      const chunk = await prisma.wallet.findMany({
        where,
        orderBy: { publicKey: "asc" },
        skip,
        take: OPS_WALLET_REFRESH_CHUNK_SIZE,
        select: { publicKey: true },
      });

      if (chunk.length === 0) break;

      const chunkResult = await walletService.refreshBalancesByPublicKeys(
        chunk.map((wallet) => wallet.publicKey)
      );
      requestedCount += chunkResult.requestedCount;
      refreshedCount += chunkResult.refreshedCount;
      missingCount += chunkResult.missingCount;

      if (chunk.length < OPS_WALLET_REFRESH_CHUNK_SIZE) break;
      skip += chunk.length;
    }

    // Filter-wide responses stay summary-only (avoid huge payloads).
    return projectWalletBalanceRefreshResult({
      refreshed: [],
      requestedCount,
      refreshedCount,
      missingCount,
    });
  },

  async lookupUser(callerUserId: string, input: OpsLookupInput) {
    await requireOperator(callerUserId);

    if (input.type === "mainWallet") {
      const user = await prisma.user.findUnique({
        where: { mainWalletPublicKey: input.publicKey },
        select: {
          id: true,
          name: true,
          mainWalletPublicKey: true,
        },
      });
      if (!user) {
        throwNotFound();
      }
      return user;
    }

    const token = await prisma.token.findUnique({
      where: { publicKey: input.publicKey },
      select: {
        user: {
          select: {
            id: true,
            name: true,
            mainWalletPublicKey: true,
          },
        },
      },
    });
    if (!token?.user) {
      throwNotFound();
    }
    return token.user;
  },

  /**
   * Resolve a pasted pubkey to the right Ops detail.
   * Order: User main wallet → Wallet → Token mint. Unknown → not-found.
   */
  async jump(
    callerUserId: string,
    input: OpsJumpInput
  ): Promise<OpsJumpResult> {
    await requireOperator(callerUserId);

    const user = await prisma.user.findUnique({
      where: { mainWalletPublicKey: input.publicKey },
      select: { id: true },
    });
    if (user) {
      return { kind: "user", userId: user.id };
    }

    const wallet = await prisma.wallet.findUnique({
      where: { publicKey: input.publicKey },
      select: { publicKey: true },
    });
    if (wallet) {
      return { kind: "wallet", publicKey: wallet.publicKey };
    }

    const token = await prisma.token.findUnique({
      where: { publicKey: input.publicKey },
      select: { publicKey: true },
    });
    if (token) {
      return { kind: "token", publicKey: token.publicKey };
    }

    throwNotFound();
  },

  async getUserSpine(callerUserId: string, userId: string) {
    await requireOperator(callerUserId);

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        mainWalletPublicKey: true,
        plan: true,
        paidPlanStartedAt: true,
        paidPlanExpiresAt: true,
        mainWallet: {
          select: {
            publicKey: true,
            type: true,
            balanceSol: true,
            balanceRefreshedAt: true,
            tokenPublicKey: true,
          },
        },
        tokens: {
          orderBy: { createdAt: "desc" },
          select: {
            publicKey: true,
            name: true,
            symbol: true,
            status: true,
            createdAt: true,
          },
        },
        launches: {
          orderBy: { createdAt: "desc" },
          select: {
            id: true,
            status: true,
            progress: true,
            currentStep: true,
            tokenPublicKey: true,
            startedAt: true,
            completedAt: true,
            createdAt: true,
            updatedAt: true,
          },
        },
        wallets: {
          orderBy: [{ type: "asc" }, { createdAt: "asc" }],
          select: {
            publicKey: true,
            type: true,
            balanceSol: true,
            balanceRefreshedAt: true,
            tokenPublicKey: true,
          },
        },
      },
    });

    if (!user) {
      throwNotFound();
    }

    const operationalWallets = user.wallets.map((wallet) => ({
      publicKey: wallet.publicKey,
      type: wallet.type,
      balanceSol: Number(wallet.balanceSol ?? 0),
      balanceRefreshedAt: wallet.balanceRefreshedAt,
      tokenPublicKey: wallet.tokenPublicKey,
    }));
    const wallets = [
      {
        publicKey: user.mainWallet.publicKey,
        type: user.mainWallet.type,
        balanceSol: Number(user.mainWallet.balanceSol ?? 0),
        balanceRefreshedAt: user.mainWallet.balanceRefreshedAt,
        tokenPublicKey: user.mainWallet.tokenPublicKey,
      },
      ...operationalWallets.filter(
        (wallet) => wallet.publicKey !== user.mainWallet.publicKey
      ),
    ];

    const spine = {
      id: user.id,
      name: user.name,
      mainWalletPublicKey: user.mainWalletPublicKey,
      plan: user.plan,
      paidPlanStartedAt: user.paidPlanStartedAt,
      paidPlanExpiresAt: user.paidPlanExpiresAt,
      tokens: user.tokens.map((token) => ({
        publicKey: token.publicKey,
        name: token.name,
        symbol: token.symbol,
        status: token.status,
        createdAt: token.createdAt,
      })),
      launches: user.launches.map((launch) => ({
        id: launch.id,
        status: launch.status,
        progress: launch.progress,
        currentStep: launch.currentStep,
        tokenPublicKey: launch.tokenPublicKey,
        startedAt: launch.startedAt,
        completedAt: launch.completedAt,
        createdAt: launch.createdAt,
        updatedAt: launch.updatedAt,
      })),
      wallets,
    };

    if (containsPrivateKeyField(spine)) {
      throw new Error("Ops projection leaked private key fields");
    }

    return spine;
  },

  async getLaunchAutopsy(callerUserId: string, launchId: string) {
    await requireOperator(callerUserId);

    const launch = await prisma.launch.findUnique({
      where: { id: launchId },
      select: {
        id: true,
        userId: true,
        status: true,
        progress: true,
        currentStep: true,
        platform: true,
        platformVersion: true,
        plan: true,
        planSchemaVersion: true,
        planPersistedAt: true,
        outcomeKind: true,
        startedAt: true,
        completedAt: true,
        cancelRequestedAt: true,
        errorMessage: true,
        tokenPublicKey: true,
        logs: {
          orderBy: { createdAt: "asc" },
          select: {
            id: true,
            level: true,
            message: true,
            step: true,
            data: true,
            createdAt: true,
          },
        },
      },
    });

    if (!launch) {
      throwNotFound();
    }

    const identity = projectOpsLaunchPlatformIdentity({
      platform: launch.platform,
      platformVersion: launch.platformVersion,
      hasPlan: launch.planPersistedAt != null,
      outcomeKind: launch.outcomeKind,
    });
    const planSummary = identity.hasPlan
      ? projectSafePumpfunPlanSummary(launch.plan)
      : null;

    const autopsy = {
      id: launch.id,
      userId: launch.userId,
      status: launch.status,
      progress: launch.progress,
      currentStep: launch.currentStep,
      startedAt: launch.startedAt,
      completedAt: launch.completedAt,
      cancelRequestedAt: launch.cancelRequestedAt,
      errorMessage: launch.errorMessage,
      tokenPublicKey: launch.tokenPublicKey,
      ...identity,
      planSchemaVersion: launch.planSchemaVersion,
      planPersistedAt: launch.planPersistedAt,
      planSummary,
      planSummaryAvailable: planSummary != null,
      jitoDiagnostics: projectJitoDiagnosticsFromLogs(launch.logs),
      logs: launch.logs.map((log) => ({
        id: log.id,
        level: log.level,
        message: log.message,
        step: log.step,
        data: omitPrivateKeyFields(log.data),
        createdAt: log.createdAt,
      })),
    };

    if (containsPrivateKeyField(autopsy)) {
      throw new Error("Ops projection leaked private key fields");
    }

    return autopsy;
  },

  async revealPrivateKey(
    callerUserId: string,
    input: OpsRevealPrivateKeyInput,
    options: OpsRevealOptions = {}
  ) {
    await requireOperator(callerUserId);

    const auditLogger = options.logger ?? defaultLogger;
    let privateKey: string;

    if (input.targetType === "wallet") {
      const wallet = await prisma.wallet.findUnique({
        where: { publicKey: input.publicKey },
        select: {
          publicKey: true,
          privateKey: true,
          userId: true,
          mainWalletUser: { select: { id: true } },
        },
      });

      const owned =
        Boolean(wallet?.userId) || Boolean(wallet?.mainWalletUser?.id);
      if (!wallet || !owned || !wallet.privateKey) {
        throwNotFound();
      }
      privateKey = wallet.privateKey;
    } else {
      const token = await prisma.token.findUnique({
        where: { publicKey: input.publicKey },
        select: {
          publicKey: true,
          privateKey: true,
          userId: true,
        },
      });
      if (!token?.userId || !token.privateKey) {
        throwNotFound();
      }
      privateKey = token.privateKey;
    }

    auditLogger.info("Ops private key reveal", {
      event: "ops.reveal_private_key",
      operatorUserId: callerUserId,
      targetType: input.targetType,
      targetPublicKey: input.publicKey,
      requestId: options.requestId,
      revealedAt: new Date().toISOString(),
    });

    return { privateKey };
  },

  async listMarketers(callerUserId: string, input: OpsListMarketersInput) {
    await requireOperator(callerUserId);

    const page = input.page ?? 1;
    const pageSize = input.pageSize ?? 25;
    const sortBy = input.sortBy ?? "createdAt";
    const sortDir = input.sortDir ?? "desc";
    const searchWhere = buildMarketerSearchWhere(input.search);
    const where: Prisma.MarketerWhereInput = {
      ...(input.isEnabled === undefined ? {} : { isEnabled: input.isEnabled }),
      ...(searchWhere ?? {}),
    };
    const skip = (page - 1) * pageSize;

    const [totalCount, rows] = await Promise.all([
      prisma.marketer.count({ where }),
      prisma.marketer.findMany({
        where,
        orderBy: { [sortBy]: sortDir },
        skip,
        take: pageSize,
        select: {
          id: true,
          userId: true,
          nickname: true,
          feeShareRate: true,
          isEnabled: true,
          referralCode: true,
          feeCollectorPublicKey: true,
          createdAt: true,
          updatedAt: true,
          user: {
            select: {
              id: true,
              name: true,
              mainWalletPublicKey: true,
            },
          },
        },
      }),
    ]);

    const result = {
      items: rows.map((marketer) => {
        const projected = projectMarketer(marketer);
        return {
          id: projected.id,
          userId: projected.userId,
          userName: projected.userName,
          mainWalletPublicKey: projected.mainWalletPublicKey,
          nickname: projected.nickname,
          feeShareRate: projected.feeShareRate,
          isEnabled: projected.isEnabled,
          hasReferralCode: projected.hasReferralCode,
          hasFeeCollector: projected.hasFeeCollector,
          createdAt: projected.createdAt,
          updatedAt: projected.updatedAt,
        };
      }),
      totalCount,
    };

    if (containsPrivateKeyField(result)) {
      throw new Error("Ops projection leaked private key fields");
    }

    return result;
  },

  async getMarketer(callerUserId: string, input: OpsGetMarketerInput) {
    await requireOperator(callerUserId);

    const marketer = await prisma.marketer.findUnique({
      where: { id: input.marketerId },
      select: {
        id: true,
        userId: true,
        nickname: true,
        feeShareRate: true,
        isEnabled: true,
        referralCode: true,
        feeCollectorPublicKey: true,
        createdAt: true,
        updatedAt: true,
        user: {
          select: {
            id: true,
            name: true,
            mainWalletPublicKey: true,
          },
        },
      },
    });

    if (!marketer) {
      throwNotFound();
    }

    const result = projectMarketer(marketer);

    if (containsPrivateKeyField(result)) {
      throw new Error("Ops projection leaked private key fields");
    }

    return result;
  },

  async createMarketer(callerUserId: string, input: OpsCreateMarketerInput) {
    await requireOperator(callerUserId);

    const user = await prisma.user.findUnique({
      where: { id: input.userId },
      select: {
        id: true,
        name: true,
        mainWalletPublicKey: true,
        marketer: { select: { id: true } },
      },
    });

    if (!user) {
      throw new AppError("User not found", 404);
    }

    if (user.marketer) {
      throw new AppError("User is already a Marketer", 400);
    }

    try {
      const created = await prisma.marketer.create({
        data: {
          userId: input.userId,
          nickname: input.nickname,
          feeShareRate: input.feeShareRate,
          isEnabled: input.isEnabled ?? true,
        },
        select: {
          id: true,
          userId: true,
          nickname: true,
          feeShareRate: true,
          isEnabled: true,
          referralCode: true,
          feeCollectorPublicKey: true,
          createdAt: true,
          updatedAt: true,
          user: {
            select: {
              id: true,
              name: true,
              mainWalletPublicKey: true,
            },
          },
        },
      });

      const result = projectMarketer(created);

      if (containsPrivateKeyField(result)) {
        throw new Error("Ops projection leaked private key fields");
      }

      return result;
    } catch (error) {
      const message = marketerUniqueConstraintMessage(error);
      if (message) {
        throw new AppError(message, 400);
      }
      throw error;
    }
  },

  async updateMarketer(callerUserId: string, input: OpsUpdateMarketerInput) {
    await requireOperator(callerUserId);

    const existing = await prisma.marketer.findUnique({
      where: { id: input.marketerId },
      select: { id: true },
    });

    if (!existing) {
      throwNotFound();
    }

    try {
      const updated = await prisma.marketer.update({
        where: { id: input.marketerId },
        data: {
          ...(input.nickname !== undefined ? { nickname: input.nickname } : {}),
          ...(input.feeShareRate !== undefined
            ? { feeShareRate: input.feeShareRate }
            : {}),
          ...(input.isEnabled !== undefined
            ? { isEnabled: input.isEnabled }
            : {}),
        },
        select: {
          id: true,
          userId: true,
          nickname: true,
          feeShareRate: true,
          isEnabled: true,
          referralCode: true,
          feeCollectorPublicKey: true,
          createdAt: true,
          updatedAt: true,
          user: {
            select: {
              id: true,
              name: true,
              mainWalletPublicKey: true,
            },
          },
        },
      });

      const result = projectMarketer(updated);

      if (containsPrivateKeyField(result)) {
        throw new Error("Ops projection leaked private key fields");
      }

      return result;
    } catch (error) {
      const message = marketerUniqueConstraintMessage(error);
      if (message) {
        throw new AppError(message, 400);
      }
      throw error;
    }
  },
};
