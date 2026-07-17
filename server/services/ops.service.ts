import "server-only";

import { prisma, Prisma } from "@/lib/prisma";
import { logger as defaultLogger, type LogContext } from "@/lib/logger";
import { AppError } from "@/server/errors";
import type {
  OpsListLaunchesInput,
  OpsListUsersInput,
  OpsLookupInput,
  OpsRevealPrivateKeyInput,
} from "@/server/schemas/ops.schema";

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
    const where = buildLaunchSearchWhere(input.search);
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
      items: rows.map((launch) => ({
        id: launch.id,
        status: launch.status,
        progress: launch.progress,
        currentStep: launch.currentStep,
        tokenPublicKey: launch.tokenPublicKey,
        userId: launch.userId,
        userName: launch.user.name,
        startedAt: launch.startedAt,
        createdAt: launch.createdAt,
      })),
      totalCount,
    };

    if (containsPrivateKeyField(result)) {
      throw new Error("Ops projection leaked private key fields");
    }

    return result;
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
      logs: launch.logs.map((log) => ({
        id: log.id,
        level: log.level,
        message: log.message,
        step: log.step,
        data: log.data,
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
};
