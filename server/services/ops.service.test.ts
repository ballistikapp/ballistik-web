import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test, { type TestContext } from "node:test";
import { isAppError } from "@/server/errors";

process.env.DATABASE_URL ??=
  "postgresql://postgres:postgres@127.0.0.1:5432/postgres";

const require = createRequire(import.meta.url);

const OPERATOR_ID = "operator-user";
const TARGET_USER_ID = "target-user";
const MAIN_WALLET =
  "MainWallet111111111111111111111111111111111";
const MINT = "MintToken111111111111111111111111111111111";
const DEV_WALLET =
  "DevWallet1111111111111111111111111111111111";
const SYSTEM_WALLET =
  "SystemWallet111111111111111111111111111111";
const LAUNCH_ID = "launch-1";

function restore<T extends object, K extends keyof T>(
  t: TestContext,
  target: T,
  key: K,
  value: T[K]
) {
  const original = target[key];
  target[key] = value;
  t.after(() => {
    target[key] = original;
  });
}

async function setupOpsTest(t: TestContext) {
  const serverOnlyPath = require.resolve("server-only");
  require.cache[serverOnlyPath] = {
    id: serverOnlyPath,
    filename: serverOnlyPath,
    loaded: true,
    exports: {},
    children: [],
    path: serverOnlyPath,
    paths: [],
    isPreloading: false,
    parent: undefined,
    require,
  } as unknown as NodeJS.Module;

  const { opsService } = await import("./ops.service");
  const { prisma } = await import("@/lib/prisma");

  const NOW = new Date("2026-07-17T12:00:00.000Z");
  const users = new Map<
    string,
    {
      id: string;
      name: string;
      isOperator: boolean;
      mainWalletPublicKey: string;
      plan: "FREE" | "PRO";
      paidPlanStartedAt: Date | null;
      paidPlanExpiresAt: Date | null;
      createdAt: Date;
    }
  >([
    [
      OPERATOR_ID,
      {
        id: OPERATOR_ID,
        name: "Operator",
        isOperator: true,
        mainWalletPublicKey: "OperatorMain111111111111111111111111111111",
        plan: "PRO",
        paidPlanStartedAt: null,
        paidPlanExpiresAt: null,
        // Outside the 7d window
        createdAt: new Date("2026-06-01T00:00:00.000Z"),
      },
    ],
    [
      TARGET_USER_ID,
      {
        id: TARGET_USER_ID,
        name: "Target User",
        isOperator: false,
        mainWalletPublicKey: MAIN_WALLET,
        plan: "PRO",
        paidPlanStartedAt: new Date("2026-01-01T00:00:00.000Z"),
        paidPlanExpiresAt: new Date("2026-02-01T00:00:00.000Z"),
        // Inside the 7d window
        createdAt: new Date("2026-07-15T00:00:00.000Z"),
      },
    ],
    [
      "regular-user",
      {
        id: "regular-user",
        name: "Regular",
        isOperator: false,
        mainWalletPublicKey: "RegularMain1111111111111111111111111111111",
        plan: "FREE",
        paidPlanStartedAt: null,
        paidPlanExpiresAt: null,
        // Outside the 7d window
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
      },
    ],
  ]);

  const wallets = new Map([
    [
      MAIN_WALLET,
      {
        publicKey: MAIN_WALLET,
        privateKey: "main-secret",
        type: "MAIN_WALLET" as const,
        // MAIN is owned via mainWalletUser, not Wallet.userId (matches auth create).
        userId: null as string | null,
        tokenPublicKey: null as string | null,
        balanceSol: 1.5,
        balanceRefreshedAt: new Date("2026-07-01T00:00:00.000Z"),
        isImported: false,
        isSystemWallet: false,
        createdAt: new Date("2026-06-01T00:00:00.000Z"),
        updatedAt: new Date("2026-06-01T00:00:00.000Z"),
        mainWalletUser: {
          id: TARGET_USER_ID,
          name: "Target User",
        } as { id: string; name: string } | null,
      },
    ],
    [
      DEV_WALLET,
      {
        publicKey: DEV_WALLET,
        privateKey: "dev-secret",
        type: "DEV" as const,
        userId: TARGET_USER_ID as string | null,
        tokenPublicKey: MINT as string | null,
        balanceSol: 0.25,
        balanceRefreshedAt: null as Date | null,
        isImported: false,
        isSystemWallet: false,
        createdAt: new Date("2026-06-02T00:00:00.000Z"),
        updatedAt: new Date("2026-06-02T00:00:00.000Z"),
        mainWalletUser: null as { id: string } | null,
      },
    ],
    [
      SYSTEM_WALLET,
      {
        publicKey: SYSTEM_WALLET,
        privateKey: "system-secret",
        type: "DISTRIBUTION" as const,
        userId: null as string | null,
        tokenPublicKey: null as string | null,
        balanceSol: 10,
        balanceRefreshedAt: new Date("2026-07-10T00:00:00.000Z"),
        isImported: false,
        isSystemWallet: true,
        createdAt: new Date("2026-05-01T00:00:00.000Z"),
        updatedAt: new Date("2026-05-01T00:00:00.000Z"),
        mainWalletUser: null as { id: string } | null,
      },
    ],
  ]);

  const tokens = new Map([
    [
      MINT,
      {
        publicKey: MINT,
        privateKey: "mint-secret",
        name: "Target Coin",
        symbol: "TGT",
        description: "A target token",
        imageUrl: "https://example.com/tgt.png",
        websiteUrl: "https://example.com",
        twitterUrl: null as string | null,
        telegramUrl: null as string | null,
        status: "ACTIVE" as const,
        isMayhemMode: false,
        userId: TARGET_USER_ID,
        createdAt: new Date("2026-06-02T00:00:00.000Z"),
        updatedAt: new Date("2026-06-03T00:00:00.000Z"),
        user: {
          id: TARGET_USER_ID,
          name: "Target User",
          mainWalletPublicKey: MAIN_WALLET,
        },
      },
    ],
  ]);

  const launches = new Map([
    [
      LAUNCH_ID,
      {
        id: LAUNCH_ID,
        userId: TARGET_USER_ID,
        status: "FAILED" as const,
        progress: 40,
        currentStep: "bundle_submit",
        startedAt: new Date("2026-07-14T00:00:00.000Z"),
        completedAt: new Date("2026-07-14T00:05:00.000Z"),
        cancelRequestedAt: null as Date | null,
        errorMessage: "bundle timed out",
        tokenPublicKey: MINT,
        // Inside the 7d window (relative to NOW in setupOpsTest)
        createdAt: new Date("2026-07-14T00:00:00.000Z"),
        updatedAt: new Date("2026-07-14T00:05:00.000Z"),
        logs: [
          {
            id: "log-1",
            level: "INFO" as const,
            message: "started",
            step: "init",
            data: { ok: true },
            createdAt: new Date("2026-07-14T00:00:01.000Z"),
          },
        ],
      },
    ],
  ]);

  restore(t, prisma.user, "findUnique", (async (args: {
    where: { id?: string; mainWalletPublicKey?: string };
    select?: Record<string, unknown>;
  }) => {
    if (args.where.id) {
      const user = users.get(args.where.id);
      if (!user) return null;
      if (args.select && "isOperator" in args.select && Object.keys(args.select).length === 1) {
        return { isOperator: user.isOperator };
      }
      if (args.select && "tokens" in args.select) {
        const mainWallet = wallets.get(user.mainWalletPublicKey);
        return {
          id: user.id,
          name: user.name,
          mainWalletPublicKey: user.mainWalletPublicKey,
          plan: user.plan,
          paidPlanStartedAt: user.paidPlanStartedAt,
          paidPlanExpiresAt: user.paidPlanExpiresAt,
          mainWallet: mainWallet
            ? {
                publicKey: mainWallet.publicKey,
                type: mainWallet.type,
                balanceSol: mainWallet.balanceSol,
                balanceRefreshedAt: mainWallet.balanceRefreshedAt,
                tokenPublicKey: mainWallet.tokenPublicKey,
              }
            : null,
          tokens: [...tokens.values()]
            .filter((token) => token.userId === user.id)
            .map((token) => ({
              publicKey: token.publicKey,
              name: token.name,
              symbol: token.symbol,
              status: token.status,
              createdAt: token.createdAt,
              privateKey: token.privateKey,
            })),
          launches: [...launches.values()]
            .filter((launch) => launch.userId === user.id)
            .map((launch) => ({
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
          // MAIN is linked via mainWalletUser, not Wallet.userId — omit it here.
          wallets: [...wallets.values()]
            .filter(
              (wallet) =>
                wallet.userId === user.id &&
                wallet.publicKey !== user.mainWalletPublicKey
            )
            .map((wallet) => ({
              publicKey: wallet.publicKey,
              type: wallet.type,
              balanceSol: wallet.balanceSol,
              balanceRefreshedAt: wallet.balanceRefreshedAt,
              tokenPublicKey: wallet.tokenPublicKey,
              privateKey: wallet.privateKey,
            })),
        };
      }
      return user;
    }
    if (args.where.mainWalletPublicKey) {
      const user = [...users.values()].find(
        (candidate) =>
          candidate.mainWalletPublicKey === args.where.mainWalletPublicKey
      );
      if (!user) return null;
      return {
        id: user.id,
        name: user.name,
        mainWalletPublicKey: user.mainWalletPublicKey,
      };
    }
    return null;
  }) as unknown as typeof prisma.user.findUnique);

  restore(t, prisma.token, "findUnique", (async (args: {
    where: { publicKey: string };
    select?: Record<string, unknown>;
  }) => {
    const token = tokens.get(args.where.publicKey);
    if (!token) return null;
    if (args.select && "user" in args.select && !("name" in (args.select ?? {}))) {
      return { user: token.user };
    }
    if (args.select && "name" in args.select) {
      return {
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
        createdAt: token.createdAt,
        updatedAt: token.updatedAt,
        user: token.user,
        privateKey: token.privateKey,
      };
    }
    return {
      publicKey: token.publicKey,
      privateKey: token.privateKey,
      userId: token.userId,
    };
  }) as unknown as typeof prisma.token.findUnique);

  restore(t, prisma.wallet, "findUnique", (async (args: {
    where: { publicKey: string };
    select?: Record<string, unknown>;
  }) => {
    const wallet = wallets.get(args.where.publicKey);
    if (!wallet) return null;
    if (args.select && "type" in args.select) {
      const owner = wallet.userId ? users.get(wallet.userId) : null;
      const token = wallet.tokenPublicKey
        ? tokens.get(wallet.tokenPublicKey)
        : null;
      return {
        publicKey: wallet.publicKey,
        type: wallet.type,
        userId: wallet.userId,
        tokenPublicKey: wallet.tokenPublicKey,
        balanceSol: wallet.balanceSol,
        balanceRefreshedAt: wallet.balanceRefreshedAt,
        isImported: wallet.isImported,
        isSystemWallet: wallet.isSystemWallet,
        createdAt: wallet.createdAt,
        updatedAt: wallet.updatedAt,
        user: owner
          ? {
              id: owner.id,
              name: owner.name,
            }
          : null,
        mainWalletUser: wallet.mainWalletUser,
        token: token
          ? {
              publicKey: token.publicKey,
              name: token.name,
              symbol: token.symbol,
            }
          : null,
        privateKey: wallet.privateKey,
      };
    }
    return {
      publicKey: wallet.publicKey,
      privateKey: wallet.privateKey,
      userId: wallet.userId,
      mainWalletUser: wallet.mainWalletUser
        ? { id: wallet.mainWalletUser.id }
        : null,
    };
  }) as unknown as typeof prisma.wallet.findUnique);

  restore(t, prisma.launch, "findUnique", (async (args: {
    where: { id: string };
  }) => {
    const launch = launches.get(args.where.id);
    if (!launch) return null;
    return {
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
      logs: launch.logs,
      input: { secret: "should-not-appear" },
      result: { privateKey: "should-not-appear" },
    };
  }) as unknown as typeof prisma.launch.findUnique);

  function matchesContains(
    value: string | null | undefined,
    search: string
  ): boolean {
    return (value ?? "").toLowerCase().includes(search.toLowerCase());
  }

  function filterUsers(where?: {
    createdAt?: { gte?: Date };
    OR?: Array<Record<string, { contains?: string; mode?: string } | string>>;
  }) {
    const since = where?.createdAt?.gte;
    const or = where?.OR;
    return [...users.values()].filter((user) => {
      if (since && user.createdAt < since) return false;
      if (!or || or.length === 0) return true;
      return or.some((clause) => {
        if ("id" in clause && typeof clause.id === "object") {
          return matchesContains(user.id, clause.id.contains ?? "");
        }
        if ("name" in clause && typeof clause.name === "object") {
          return matchesContains(user.name, clause.name.contains ?? "");
        }
        if (
          "mainWalletPublicKey" in clause &&
          typeof clause.mainWalletPublicKey === "object"
        ) {
          return matchesContains(
            user.mainWalletPublicKey,
            clause.mainWalletPublicKey.contains ?? ""
          );
        }
        return false;
      });
    });
  }

  function filterLaunches(where?: {
    createdAt?: { gte?: Date };
    status?: string;
    userId?: string;
    OR?: Array<
      | { id: { contains: string; mode?: string } }
      | { tokenPublicKey: { contains: string; mode?: string } }
      | { userId: { contains: string; mode?: string } }
      | { currentStep: { contains: string; mode?: string } }
      | { status: string }
    >;
  }) {
    const since = where?.createdAt?.gte;
    const status = where?.status;
    const userId = where?.userId;
    const or = where?.OR;
    return [...launches.values()].filter((launch) => {
      if (since && launch.createdAt < since) return false;
      if (status && launch.status !== status) return false;
      if (userId && launch.userId !== userId) return false;
      if (!or || or.length === 0) return true;
      return or.some((clause) => {
        if ("id" in clause) {
          return matchesContains(launch.id, clause.id.contains);
        }
        if ("tokenPublicKey" in clause) {
          return matchesContains(
            launch.tokenPublicKey,
            clause.tokenPublicKey.contains
          );
        }
        if ("userId" in clause) {
          return matchesContains(launch.userId, clause.userId.contains);
        }
        if ("currentStep" in clause) {
          return matchesContains(
            launch.currentStep,
            clause.currentStep.contains
          );
        }
        if ("status" in clause) {
          return launch.status === clause.status;
        }
        return false;
      });
    });
  }

  restore(t, prisma.user, "count", (async (args?: {
    where?: {
      createdAt?: { gte?: Date };
      OR?: Array<Record<string, { contains?: string; mode?: string } | string>>;
    };
  }) => {
    return filterUsers(args?.where).length;
  }) as unknown as typeof prisma.user.count);

  restore(t, prisma.user, "findMany", (async (args?: {
    where?: {
      createdAt?: { gte?: Date };
      OR?: Array<Record<string, { contains?: string; mode?: string } | string>>;
    };
    orderBy?: Record<string, "asc" | "desc">;
    skip?: number;
    take?: number;
    select?: Record<string, unknown>;
  }) => {
    let rows = filterUsers(args?.where);
    const orderBy = args?.orderBy ?? {};
    const [sortKey, sortDir] = Object.entries(orderBy)[0] ?? ["createdAt", "desc"];
    rows = [...rows].sort((a, b) => {
      const left = a[sortKey as keyof typeof a];
      const right = b[sortKey as keyof typeof b];
      if (left == null && right == null) return 0;
      if (left == null) return sortDir === "asc" ? -1 : 1;
      if (right == null) return sortDir === "asc" ? 1 : -1;
      if (left < right) return sortDir === "asc" ? -1 : 1;
      if (left > right) return sortDir === "asc" ? 1 : -1;
      return 0;
    });
    const skip = args?.skip ?? 0;
    const take = args?.take ?? rows.length;
    return rows.slice(skip, skip + take).map((user) => ({
      id: user.id,
      name: user.name,
      mainWalletPublicKey: user.mainWalletPublicKey,
      plan: user.plan,
      paidPlanExpiresAt: user.paidPlanExpiresAt,
      createdAt: user.createdAt,
    }));
  }) as unknown as typeof prisma.user.findMany);

  function filterTokens(where?: {
    userId?: string;
    OR?: Array<
      | { publicKey: { contains: string; mode?: string } }
      | { name: { contains: string; mode?: string } }
      | { symbol: { contains: string; mode?: string } }
      | { userId: { contains: string; mode?: string } }
      | { status: string }
    >;
  }) {
    const userId = where?.userId;
    const or = where?.OR;
    return [...tokens.values()].filter((token) => {
      if (userId && token.userId !== userId) return false;
      if (!or || or.length === 0) return true;
      return or.some((clause) => {
        if ("publicKey" in clause) {
          return matchesContains(token.publicKey, clause.publicKey.contains);
        }
        if ("name" in clause) {
          return matchesContains(token.name, clause.name.contains);
        }
        if ("symbol" in clause) {
          return matchesContains(token.symbol, clause.symbol.contains);
        }
        if ("userId" in clause) {
          return matchesContains(token.userId, clause.userId.contains);
        }
        if ("status" in clause) {
          return token.status === clause.status;
        }
        return false;
      });
    });
  }

  function matchesWalletOwnerScope(
    wallet: {
      userId: string | null;
      mainWalletUser: { id: string } | null;
    },
    clause:
      | { userId: string }
      | { mainWalletUser: { id: string } }
      | { publicKey: { contains: string; mode?: string } }
      | { userId: { contains: string; mode?: string } }
      | { tokenPublicKey: { contains: string; mode?: string } }
      | { type: string }
  ): boolean | null {
    if (
      "userId" in clause &&
      typeof clause.userId === "string"
    ) {
      return wallet.userId === clause.userId;
    }
    if ("mainWalletUser" in clause) {
      return wallet.mainWalletUser?.id === clause.mainWalletUser.id;
    }
    return null;
  }

  function filterWallets(where?: {
    type?: string;
    isSystemWallet?: boolean;
    AND?: Array<{
      OR?: Array<
        | { userId: string }
        | { mainWalletUser: { id: string } }
        | { publicKey: { contains: string; mode?: string } }
        | { userId: { contains: string; mode?: string } }
        | { tokenPublicKey: { contains: string; mode?: string } }
        | { type: string }
      >;
    }>;
    OR?: Array<
      | { userId: string }
      | { mainWalletUser: { id: string } }
      | { publicKey: { contains: string; mode?: string } }
      | { userId: { contains: string; mode?: string } }
      | { tokenPublicKey: { contains: string; mode?: string } }
      | { type: string }
    >;
  }) {
    const andGroups = where?.AND;
    const or = where?.OR;
    return [...wallets.values()].filter((wallet) => {
      if (where?.type && wallet.type !== where.type) return false;
      if (
        where?.isSystemWallet !== undefined &&
        wallet.isSystemWallet !== where.isSystemWallet
      ) {
        return false;
      }

      const matchesOrGroup = (
        group:
          | Array<
              | { userId: string }
              | { mainWalletUser: { id: string } }
              | { publicKey: { contains: string; mode?: string } }
              | { userId: { contains: string; mode?: string } }
              | { tokenPublicKey: { contains: string; mode?: string } }
              | { type: string }
            >
          | undefined
      ) => {
        if (!group || group.length === 0) return true;
        return group.some((clause) => {
          const ownerMatch = matchesWalletOwnerScope(wallet, clause);
          if (ownerMatch !== null) return ownerMatch;
          if ("publicKey" in clause && typeof clause.publicKey === "object") {
            return matchesContains(
              wallet.publicKey,
              clause.publicKey.contains
            );
          }
          if ("userId" in clause && typeof clause.userId === "object") {
            return matchesContains(wallet.userId, clause.userId.contains);
          }
          if ("tokenPublicKey" in clause) {
            return matchesContains(
              wallet.tokenPublicKey,
              clause.tokenPublicKey.contains
            );
          }
          if ("type" in clause) {
            return wallet.type === clause.type;
          }
          return false;
        });
      };

      if (andGroups && andGroups.length > 0) {
        return andGroups.every((group) => matchesOrGroup(group.OR));
      }
      return matchesOrGroup(or);
    });
  }

  restore(t, prisma.token, "count", (async (args?: {
    where?: {
      userId?: string;
      OR?: Array<
        | { publicKey: { contains: string; mode?: string } }
        | { name: { contains: string; mode?: string } }
        | { symbol: { contains: string; mode?: string } }
        | { userId: { contains: string; mode?: string } }
        | { status: string }
      >;
    };
  }) => {
    if (!args?.where) return tokens.size;
    return filterTokens(args.where).length;
  }) as unknown as typeof prisma.token.count);

  restore(t, prisma.token, "findMany", (async (args?: {
    where?: {
      userId?: string;
      OR?: Array<
        | { publicKey: { contains: string; mode?: string } }
        | { name: { contains: string; mode?: string } }
        | { symbol: { contains: string; mode?: string } }
        | { userId: { contains: string; mode?: string } }
        | { status: string }
      >;
    };
    orderBy?: Record<string, "asc" | "desc">;
    skip?: number;
    take?: number;
    select?: Record<string, unknown>;
  }) => {
    let rows = filterTokens(args?.where);
    const orderBy = args?.orderBy ?? {};
    const [sortKey, sortDir] = Object.entries(orderBy)[0] ?? ["createdAt", "desc"];
    rows = [...rows].sort((a, b) => {
      const left = a[sortKey as keyof typeof a];
      const right = b[sortKey as keyof typeof b];
      if (left == null && right == null) return 0;
      if (left == null) return sortDir === "asc" ? -1 : 1;
      if (right == null) return sortDir === "asc" ? 1 : -1;
      if (left < right) return sortDir === "asc" ? -1 : 1;
      if (left > right) return sortDir === "asc" ? 1 : -1;
      return 0;
    });
    const skip = args?.skip ?? 0;
    const take = args?.take ?? rows.length;
    return rows.slice(skip, skip + take).map((token) => ({
      publicKey: token.publicKey,
      name: token.name,
      symbol: token.symbol,
      status: token.status,
      userId: token.userId,
      createdAt: token.createdAt,
      user: {
        id: token.user.id,
        name: token.user.name,
      },
      privateKey: token.privateKey,
    }));
  }) as unknown as typeof prisma.token.findMany);

  restore(t, prisma.wallet, "count", (async (args?: {
    where?: Parameters<typeof filterWallets>[0];
  }) => {
    return filterWallets(args?.where).length;
  }) as unknown as typeof prisma.wallet.count);

  restore(t, prisma.wallet, "findMany", (async (args?: {
    where?: Parameters<typeof filterWallets>[0];
    orderBy?: Record<string, "asc" | "desc">;
    skip?: number;
    take?: number;
    select?: Record<string, unknown>;
  }) => {
    let rows = filterWallets(args?.where);
    const orderBy = args?.orderBy ?? {};
    const [sortKey, sortDir] = Object.entries(orderBy)[0] ?? ["createdAt", "desc"];
    rows = [...rows].sort((a, b) => {
      const left = a[sortKey as keyof typeof a];
      const right = b[sortKey as keyof typeof b];
      if (left == null && right == null) return 0;
      if (left == null) return sortDir === "asc" ? -1 : 1;
      if (right == null) return sortDir === "asc" ? 1 : -1;
      if (left < right) return sortDir === "asc" ? -1 : 1;
      if (left > right) return sortDir === "asc" ? 1 : -1;
      return 0;
    });
    const skip = args?.skip ?? 0;
    const take = args?.take ?? rows.length;
    return rows.slice(skip, skip + take).map((wallet) => {
      const owner = wallet.userId ? users.get(wallet.userId) : null;
      return {
        publicKey: wallet.publicKey,
        type: wallet.type,
        userId: wallet.userId,
        tokenPublicKey: wallet.tokenPublicKey,
        isSystemWallet: wallet.isSystemWallet,
        isImported: wallet.isImported,
        balanceSol: wallet.balanceSol,
        balanceRefreshedAt: wallet.balanceRefreshedAt,
        createdAt: wallet.createdAt,
        user: owner
          ? {
              id: owner.id,
              name: owner.name,
            }
          : null,
        mainWalletUser: wallet.mainWalletUser,
        privateKey: wallet.privateKey,
      };
    });
  }) as unknown as typeof prisma.wallet.findMany);

  restore(t, prisma.launch, "count", (async (args?: {
    where?: {
      createdAt?: { gte?: Date };
      status?: string;
      userId?: string;
      OR?: Array<
        | { id: { contains: string; mode?: string } }
        | { tokenPublicKey: { contains: string; mode?: string } }
        | { userId: { contains: string; mode?: string } }
        | { currentStep: { contains: string; mode?: string } }
        | { status: string }
      >;
    };
  }) => {
    return filterLaunches(args?.where).length;
  }) as unknown as typeof prisma.launch.count);

  restore(t, prisma.launch, "findMany", (async (args?: {
    where?: {
      createdAt?: { gte?: Date };
      status?: string;
      userId?: string;
      OR?: Array<
        | { id: { contains: string; mode?: string } }
        | { tokenPublicKey: { contains: string; mode?: string } }
        | { userId: { contains: string; mode?: string } }
        | { currentStep: { contains: string; mode?: string } }
        | { status: string }
      >;
    };
    orderBy?: Record<string, "asc" | "desc">;
    skip?: number;
    take?: number;
    select?: Record<string, unknown>;
  }) => {
    let rows = filterLaunches(args?.where);
    const orderBy = args?.orderBy ?? {};
    const [sortKey, sortDir] = Object.entries(orderBy)[0] ?? ["createdAt", "desc"];
    rows = [...rows].sort((a, b) => {
      const left = a[sortKey as keyof typeof a];
      const right = b[sortKey as keyof typeof b];
      if (left == null && right == null) return 0;
      if (left == null) return sortDir === "asc" ? -1 : 1;
      if (right == null) return sortDir === "asc" ? 1 : -1;
      if (left < right) return sortDir === "asc" ? -1 : 1;
      if (left > right) return sortDir === "asc" ? 1 : -1;
      return 0;
    });
    const skip = args?.skip ?? 0;
    const take = args?.take ?? rows.length;
    return rows.slice(skip, skip + take).map((launch) => {
      const user = users.get(launch.userId);
      return {
        id: launch.id,
        status: launch.status,
        progress: launch.progress,
        currentStep: launch.currentStep,
        tokenPublicKey: launch.tokenPublicKey,
        userId: launch.userId,
        startedAt: launch.startedAt,
        createdAt: launch.createdAt,
        user: user
          ? {
              id: user.id,
              name: user.name,
            }
          : null,
        // Intentionally present in DB row shape; list projection must strip it.
        input: { privateKey: "should-not-appear" },
      };
    });
  }) as unknown as typeof prisma.launch.findMany);

  return { opsService, NOW };
}

async function expectNotFound(promise: Promise<unknown>) {
  await assert.rejects(promise, (error: unknown) => {
    assert.equal(isAppError(error), true);
    if (isAppError(error)) {
      assert.equal(error.statusCode, 404);
      assert.equal(error.message, "Not found");
    }
    return true;
  });
}

function assertNoPrivateKeyFields(value: unknown) {
  const json = JSON.stringify(value);
  assert.equal(json.includes("privateKey"), false);
  assert.equal(json.includes("main-secret"), false);
  assert.equal(json.includes("dev-secret"), false);
  assert.equal(json.includes("mint-secret"), false);
  assert.equal(json.includes("system-secret"), false);
}

test("non-Operator cannot read Ops Overview", async (t) => {
  const { opsService } = await setupOpsTest(t);
  await expectNotFound(opsService.getOverview("regular-user"));
});

test("Operator Ops Overview returns the five summary tiles", async (t) => {
  const { opsService, NOW } = await setupOpsTest(t);
  const overview = await opsService.getOverview(OPERATOR_ID, { now: NOW });
  assert.deepEqual(overview, {
    newUsers7d: 1,
    launches7d: 1,
    failedLaunches7d: 1,
    totalUsers: 3,
    totalTokens: 1,
  });
});

test("non-Operator cannot read User spine", async (t) => {
  const { opsService } = await setupOpsTest(t);
  await expectNotFound(opsService.getUserSpine("regular-user", TARGET_USER_ID));
});

test("non-Operator cannot read Launch autopsy", async (t) => {
  const { opsService } = await setupOpsTest(t);
  await expectNotFound(opsService.getLaunchAutopsy("regular-user", LAUNCH_ID));
});

test("non-Operator cannot reveal private keys", async (t) => {
  const { opsService } = await setupOpsTest(t);
  await expectNotFound(
    opsService.revealPrivateKey("regular-user", {
      targetType: "wallet",
      publicKey: MAIN_WALLET,
    })
  );
});

test("Operator lookup by main wallet succeeds", async (t) => {
  const { opsService } = await setupOpsTest(t);
  const result = await opsService.lookupUser(OPERATOR_ID, {
    type: "mainWallet",
    publicKey: MAIN_WALLET,
  });
  assert.equal(result.id, TARGET_USER_ID);
  assert.equal(result.mainWalletPublicKey, MAIN_WALLET);
});

test("Operator lookup by mint resolves to owning User", async (t) => {
  const { opsService } = await setupOpsTest(t);
  const result = await opsService.lookupUser(OPERATOR_ID, {
    type: "mint",
    publicKey: MINT,
  });
  assert.equal(result.id, TARGET_USER_ID);
});

test("Operator lookup unknown identifier fails closed", async (t) => {
  const { opsService } = await setupOpsTest(t);
  await expectNotFound(
    opsService.lookupUser(OPERATOR_ID, {
      type: "mainWallet",
      publicKey: "UnknownWallet11111111111111111111111111111",
    })
  );
});

test("Operator jump resolves main-wallet pubkey to User", async (t) => {
  const { opsService } = await setupOpsTest(t);
  const result = await opsService.jump(OPERATOR_ID, { publicKey: MAIN_WALLET });
  assert.deepEqual(result, { kind: "user", userId: TARGET_USER_ID });
});

test("Operator jump resolves Wallet pubkey to Wallet", async (t) => {
  const { opsService } = await setupOpsTest(t);
  const result = await opsService.jump(OPERATOR_ID, { publicKey: DEV_WALLET });
  assert.deepEqual(result, { kind: "wallet", publicKey: DEV_WALLET });
});

test("Operator jump resolves Token mint to Token", async (t) => {
  const { opsService } = await setupOpsTest(t);
  const result = await opsService.jump(OPERATOR_ID, { publicKey: MINT });
  assert.deepEqual(result, { kind: "token", publicKey: MINT });
});

test("Operator jump unknown identifier fails closed", async (t) => {
  const { opsService } = await setupOpsTest(t);
  await expectNotFound(
    opsService.jump(OPERATOR_ID, {
      publicKey: "UnknownWallet11111111111111111111111111111",
    })
  );
});

test("non-Operator cannot jump", async (t) => {
  const { opsService } = await setupOpsTest(t);
  await expectNotFound(
    opsService.jump("regular-user", { publicKey: MAIN_WALLET })
  );
});

test("User spine omits private keys and includes MAIN balance", async (t) => {
  const { opsService } = await setupOpsTest(t);
  const spine = await opsService.getUserSpine(OPERATOR_ID, TARGET_USER_ID);
  assert.equal(spine.id, TARGET_USER_ID);
  assert.equal(spine.tokens.length, 1);
  assert.equal(spine.launches.length, 1);
  assert.equal(spine.wallets.length, 2);
  assert.equal(spine.wallets[0]?.publicKey, MAIN_WALLET);
  assert.equal(spine.wallets[0]?.balanceSol, 1.5);
  assertNoPrivateKeyFields(spine);
});

test("Launch autopsy omits private keys and raw input/result", async (t) => {
  const { opsService } = await setupOpsTest(t);
  const autopsy = await opsService.getLaunchAutopsy(OPERATOR_ID, LAUNCH_ID);
  assert.equal(autopsy.id, LAUNCH_ID);
  assert.equal(autopsy.errorMessage, "bundle timed out");
  assert.equal(autopsy.logs.length, 1);
  assert.equal("input" in autopsy, false);
  assert.equal("result" in autopsy, false);
  assertNoPrivateKeyFields(autopsy);
});

test("reveal returns wallet secret and logs Operator + target", async (t) => {
  const { opsService } = await setupOpsTest(t);
  const auditLines: Array<{ message: string; context?: Record<string, unknown> }> =
    [];

  const result = await opsService.revealPrivateKey(
    OPERATOR_ID,
    { targetType: "wallet", publicKey: MAIN_WALLET },
    {
      requestId: "req-1",
      logger: {
        info(message, context) {
          auditLines.push({ message, context });
        },
      },
    }
  );

  assert.equal(result.privateKey, "main-secret");
  assert.equal(auditLines.length, 1);
  assert.equal(auditLines[0]?.message, "Ops private key reveal");
  assert.equal(auditLines[0]?.context?.operatorUserId, OPERATOR_ID);
  assert.equal(auditLines[0]?.context?.targetType, "wallet");
  assert.equal(auditLines[0]?.context?.targetPublicKey, MAIN_WALLET);
  assert.equal(auditLines[0]?.context?.requestId, "req-1");
});

test("reveal returns mint secret and logs Operator + target", async (t) => {
  const { opsService } = await setupOpsTest(t);
  const auditLines: Array<{ message: string; context?: Record<string, unknown> }> =
    [];

  const result = await opsService.revealPrivateKey(
    OPERATOR_ID,
    { targetType: "mint", publicKey: MINT },
    {
      logger: {
        info(message, context) {
          auditLines.push({ message, context });
        },
      },
    }
  );

  assert.equal(result.privateKey, "mint-secret");
  assert.equal(auditLines[0]?.context?.targetType, "mint");
  assert.equal(auditLines[0]?.context?.targetPublicKey, MINT);
});

test("non-Operator cannot list Users", async (t) => {
  const { opsService } = await setupOpsTest(t);
  await expectNotFound(
    opsService.listUsers("regular-user", { page: 1, pageSize: 25 })
  );
});

test("non-Operator cannot list Launches", async (t) => {
  const { opsService } = await setupOpsTest(t);
  await expectNotFound(
    opsService.listLaunches("regular-user", { page: 1, pageSize: 25 })
  );
});

test("Operator listUsers paginates, defaults createdAt desc, omits private keys", async (t) => {
  const { opsService } = await setupOpsTest(t);
  const page = await opsService.listUsers(OPERATOR_ID, {
    page: 1,
    pageSize: 2,
  });

  assert.equal(page.totalCount, 3);
  assert.equal(page.items.length, 2);
  assert.equal(page.items[0]?.id, TARGET_USER_ID);
  assert.equal(page.items[1]?.id, OPERATOR_ID);
  assert.equal(page.items[0]?.mainWalletPublicKey, MAIN_WALLET);
  assert.equal(page.items[0]?.plan, "PRO");
  assertNoPrivateKeyFields(page);
});

test("Operator listUsers searches name, main wallet, and id", async (t) => {
  const { opsService } = await setupOpsTest(t);

  const byName = await opsService.listUsers(OPERATOR_ID, {
    page: 1,
    pageSize: 25,
    search: "target",
  });
  assert.equal(byName.totalCount, 1);
  assert.equal(byName.items[0]?.id, TARGET_USER_ID);

  const byWallet = await opsService.listUsers(OPERATOR_ID, {
    page: 1,
    pageSize: 25,
    search: MAIN_WALLET.slice(0, 12),
  });
  assert.equal(byWallet.totalCount, 1);
  assert.equal(byWallet.items[0]?.id, TARGET_USER_ID);

  const byId = await opsService.listUsers(OPERATOR_ID, {
    page: 1,
    pageSize: 25,
    search: "regular-user",
  });
  assert.equal(byId.totalCount, 1);
  assert.equal(byId.items[0]?.id, "regular-user");
});

test("Operator listUsers sorts by allowed columns", async (t) => {
  const { opsService } = await setupOpsTest(t);
  const page = await opsService.listUsers(OPERATOR_ID, {
    page: 1,
    pageSize: 25,
    sortBy: "name",
    sortDir: "asc",
  });

  assert.deepEqual(
    page.items.map((user) => user.name),
    ["Operator", "Regular", "Target User"]
  );
});

test("Operator listLaunches includes owner and omits private keys", async (t) => {
  const { opsService } = await setupOpsTest(t);
  const page = await opsService.listLaunches(OPERATOR_ID, {
    page: 1,
    pageSize: 25,
  });

  assert.equal(page.totalCount, 1);
  assert.equal(page.items[0]?.id, LAUNCH_ID);
  assert.equal(page.items[0]?.userId, TARGET_USER_ID);
  assert.equal(page.items[0]?.userName, "Target User");
  assert.equal(page.items[0]?.status, "FAILED");
  assert.equal(page.items[0]?.tokenPublicKey, MINT);
  assert.equal("input" in (page.items[0] as object), false);
  assertNoPrivateKeyFields(page);
});

test("Operator listLaunches searches id, mint, user, status, and step", async (t) => {
  const { opsService } = await setupOpsTest(t);

  const byStatus = await opsService.listLaunches(OPERATOR_ID, {
    page: 1,
    pageSize: 25,
    search: "fail",
  });
  assert.equal(byStatus.totalCount, 1);
  assert.equal(byStatus.items[0]?.id, LAUNCH_ID);

  const byStep = await opsService.listLaunches(OPERATOR_ID, {
    page: 1,
    pageSize: 25,
    search: "bundle_submit",
  });
  assert.equal(byStep.totalCount, 1);

  const miss = await opsService.listLaunches(OPERATOR_ID, {
    page: 1,
    pageSize: 25,
    search: "no-such-launch",
  });
  assert.equal(miss.totalCount, 0);
  assert.equal(miss.items.length, 0);
});

test("Operator listLaunches sorts by allowed columns", async (t) => {
  const { opsService } = await setupOpsTest(t);
  const page = await opsService.listLaunches(OPERATOR_ID, {
    page: 1,
    pageSize: 25,
    sortBy: "status",
    sortDir: "asc",
  });

  assert.equal(page.items[0]?.id, LAUNCH_ID);
  assert.equal(page.items[0]?.status, "FAILED");
});

test("non-Operator cannot list Tokens", async (t) => {
  const { opsService } = await setupOpsTest(t);
  await expectNotFound(
    opsService.listTokens("regular-user", { page: 1, pageSize: 25 })
  );
});

test("non-Operator cannot list Wallets", async (t) => {
  const { opsService } = await setupOpsTest(t);
  await expectNotFound(
    opsService.listWallets("regular-user", { page: 1, pageSize: 25 })
  );
});

test("non-Operator cannot read Token detail", async (t) => {
  const { opsService } = await setupOpsTest(t);
  await expectNotFound(opsService.getToken("regular-user", MINT));
});

test("non-Operator cannot read Wallet detail", async (t) => {
  const { opsService } = await setupOpsTest(t);
  await expectNotFound(opsService.getWallet("regular-user", DEV_WALLET));
});

test("Operator listTokens paginates, includes owner, omits private keys", async (t) => {
  const { opsService } = await setupOpsTest(t);
  const page = await opsService.listTokens(OPERATOR_ID, {
    page: 1,
    pageSize: 25,
  });

  assert.equal(page.totalCount, 1);
  assert.equal(page.items[0]?.publicKey, MINT);
  assert.equal(page.items[0]?.name, "Target Coin");
  assert.equal(page.items[0]?.symbol, "TGT");
  assert.equal(page.items[0]?.status, "ACTIVE");
  assert.equal(page.items[0]?.userId, TARGET_USER_ID);
  assert.equal(page.items[0]?.userName, "Target User");
  assertNoPrivateKeyFields(page);
});

test("Operator listTokens searches mint, name, symbol, user, and status", async (t) => {
  const { opsService } = await setupOpsTest(t);

  const byName = await opsService.listTokens(OPERATOR_ID, {
    page: 1,
    pageSize: 25,
    search: "target coin",
  });
  assert.equal(byName.totalCount, 1);
  assert.equal(byName.items[0]?.publicKey, MINT);

  const byStatus = await opsService.listTokens(OPERATOR_ID, {
    page: 1,
    pageSize: 25,
    search: "active",
  });
  assert.equal(byStatus.totalCount, 1);

  const miss = await opsService.listTokens(OPERATOR_ID, {
    page: 1,
    pageSize: 25,
    search: "no-such-token",
  });
  assert.equal(miss.totalCount, 0);
});

test("Operator listTokens sorts by allowed columns", async (t) => {
  const { opsService } = await setupOpsTest(t);
  const page = await opsService.listTokens(OPERATOR_ID, {
    page: 1,
    pageSize: 25,
    sortBy: "name",
    sortDir: "asc",
  });

  assert.equal(page.items[0]?.publicKey, MINT);
  assert.equal(page.items[0]?.name, "Target Coin");
});

test("Operator listWallets includes system wallets and omits private keys", async (t) => {
  const { opsService } = await setupOpsTest(t);
  const page = await opsService.listWallets(OPERATOR_ID, {
    page: 1,
    pageSize: 25,
  });

  assert.equal(page.totalCount, 3);
  const system = page.items.find((wallet) => wallet.publicKey === SYSTEM_WALLET);
  assert.ok(system);
  assert.equal(system.isSystemWallet, true);
  assert.equal(system.userId, null);
  assert.equal(system.userName, null);

  const main = page.items.find((wallet) => wallet.publicKey === MAIN_WALLET);
  assert.ok(main);
  assert.equal(main.userId, TARGET_USER_ID);
  assert.equal(main.userName, "Target User");
  assertNoPrivateKeyFields(page);
});

test("Operator listWallets filters by type and system flag", async (t) => {
  const { opsService } = await setupOpsTest(t);

  const byType = await opsService.listWallets(OPERATOR_ID, {
    page: 1,
    pageSize: 25,
    type: "DEV",
  });
  assert.equal(byType.totalCount, 1);
  assert.equal(byType.items[0]?.publicKey, DEV_WALLET);

  const systemOnly = await opsService.listWallets(OPERATOR_ID, {
    page: 1,
    pageSize: 25,
    isSystemWallet: true,
  });
  assert.equal(systemOnly.totalCount, 1);
  assert.equal(systemOnly.items[0]?.publicKey, SYSTEM_WALLET);

  const nonSystem = await opsService.listWallets(OPERATOR_ID, {
    page: 1,
    pageSize: 25,
    isSystemWallet: false,
  });
  assert.equal(nonSystem.totalCount, 2);
});

test("Operator listTokens scopes by userId", async (t) => {
  const { opsService } = await setupOpsTest(t);

  const scoped = await opsService.listTokens(OPERATOR_ID, {
    page: 1,
    pageSize: 25,
    userId: TARGET_USER_ID,
  });
  assert.equal(scoped.totalCount, 1);
  assert.equal(scoped.items[0]?.publicKey, MINT);

  const empty = await opsService.listTokens(OPERATOR_ID, {
    page: 1,
    pageSize: 25,
    userId: OPERATOR_ID,
  });
  assert.equal(empty.totalCount, 0);
});

test("Operator listLaunches scopes by userId", async (t) => {
  const { opsService } = await setupOpsTest(t);

  const scoped = await opsService.listLaunches(OPERATOR_ID, {
    page: 1,
    pageSize: 25,
    userId: TARGET_USER_ID,
  });
  assert.equal(scoped.totalCount, 1);
  assert.equal(scoped.items[0]?.id, LAUNCH_ID);

  const empty = await opsService.listLaunches(OPERATOR_ID, {
    page: 1,
    pageSize: 25,
    userId: OPERATOR_ID,
  });
  assert.equal(empty.totalCount, 0);
});

test("Operator listWallets scopes by userId including MAIN", async (t) => {
  const { opsService } = await setupOpsTest(t);

  const scoped = await opsService.listWallets(OPERATOR_ID, {
    page: 1,
    pageSize: 25,
    userId: TARGET_USER_ID,
  });
  assert.equal(scoped.totalCount, 2);
  const keys = new Set(scoped.items.map((wallet) => wallet.publicKey));
  assert.equal(keys.has(MAIN_WALLET), true);
  assert.equal(keys.has(DEV_WALLET), true);
  assert.equal(keys.has(SYSTEM_WALLET), false);

  const empty = await opsService.listWallets(OPERATOR_ID, {
    page: 1,
    pageSize: 25,
    userId: OPERATOR_ID,
  });
  assert.equal(empty.totalCount, 0);
});

test("Operator listWallets searches pubkey, user, token, and type", async (t) => {
  const { opsService } = await setupOpsTest(t);

  const byPubkey = await opsService.listWallets(OPERATOR_ID, {
    page: 1,
    pageSize: 25,
    search: DEV_WALLET.slice(0, 10),
  });
  assert.equal(byPubkey.totalCount, 1);
  assert.equal(byPubkey.items[0]?.publicKey, DEV_WALLET);

  const byType = await opsService.listWallets(OPERATOR_ID, {
    page: 1,
    pageSize: 25,
    search: "main",
  });
  assert.equal(byType.totalCount, 1);
  assert.equal(byType.items[0]?.publicKey, MAIN_WALLET);
});

test("Operator getToken returns identity, owner, and omits private key", async (t) => {
  const { opsService } = await setupOpsTest(t);
  const token = await opsService.getToken(OPERATOR_ID, MINT);

  assert.equal(token.publicKey, MINT);
  assert.equal(token.name, "Target Coin");
  assert.equal(token.symbol, "TGT");
  assert.equal(token.status, "ACTIVE");
  assert.equal(token.description, "A target token");
  assert.equal(token.userId, TARGET_USER_ID);
  assert.equal(token.userName, "Target User");
  assert.equal(token.userMainWalletPublicKey, MAIN_WALLET);
  assertNoPrivateKeyFields(token);
});

test("Operator getToken unknown mint fails closed", async (t) => {
  const { opsService } = await setupOpsTest(t);
  await expectNotFound(
    opsService.getToken(
      OPERATOR_ID,
      "UnknownMint1111111111111111111111111111111"
    )
  );
});

test("Operator getWallet returns type, owner, stored balance, omits private key", async (t) => {
  const { opsService } = await setupOpsTest(t);
  const wallet = await opsService.getWallet(OPERATOR_ID, DEV_WALLET);

  assert.equal(wallet.publicKey, DEV_WALLET);
  assert.equal(wallet.type, "DEV");
  assert.equal(wallet.userId, TARGET_USER_ID);
  assert.equal(wallet.userName, "Target User");
  assert.equal(wallet.tokenPublicKey, MINT);
  assert.equal(wallet.tokenName, "Target Coin");
  assert.equal(wallet.tokenSymbol, "TGT");
  assert.equal(wallet.balanceSol, 0.25);
  assert.equal(wallet.isSystemWallet, false);
  assertNoPrivateKeyFields(wallet);
});

test("Operator getWallet resolves MAIN owner via mainWalletUser", async (t) => {
  const { opsService } = await setupOpsTest(t);
  const wallet = await opsService.getWallet(OPERATOR_ID, MAIN_WALLET);

  assert.equal(wallet.publicKey, MAIN_WALLET);
  assert.equal(wallet.type, "MAIN_WALLET");
  assert.equal(wallet.userId, TARGET_USER_ID);
  assert.equal(wallet.userName, "Target User");
  assertNoPrivateKeyFields(wallet);
});

test("Operator getWallet includes system wallets with null owner", async (t) => {
  const { opsService } = await setupOpsTest(t);
  const wallet = await opsService.getWallet(OPERATOR_ID, SYSTEM_WALLET);

  assert.equal(wallet.publicKey, SYSTEM_WALLET);
  assert.equal(wallet.isSystemWallet, true);
  assert.equal(wallet.userId, null);
  assert.equal(wallet.userName, null);
  assert.equal(wallet.balanceSol, 10);
  assertNoPrivateKeyFields(wallet);
});
