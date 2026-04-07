import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test, { type TestContext } from "node:test";

process.env.DATABASE_URL ??=
  "postgresql://postgres:postgres@127.0.0.1:5432/postgres";

const require = createRequire(import.meta.url);

const TOKEN_PUBLIC_KEY = "11111111111111111111111111111111";
const DEFAULT_MAIN_WALLET_PUBLIC_KEY = "main-wallet";

function sumSolAmounts(rows: Array<{ solAmount: number }>) {
  return rows.reduce((sum, row) => sum + row.solAmount, 0);
}

function createLaunchInput(
  devWalletOption: "generate" | "system" | "use_main" | "import" = "generate"
) {
  return {
    devWalletOption,
    bundleBuyEnabled: true,
    bundlerWalletCount: 9,
    distributionWalletMultiplier: 0,
    vanityMint: false,
    removeAttribution: false,
  };
}

type LaunchTradeBuyRow = {
  userId: string;
  tokenPublicKey: string;
  status: "CONFIRMED";
  type: "TRADE_BUY";
  source: "LAUNCH";
  referenceId: string;
  walletPublicKey: string;
  solAmount: number;
};

type DashboardPnlTestOptions = {
  userId: string;
  launch?: { id: string; input: ReturnType<typeof createLaunchInput> } | null;
  tokenDevWalletPublicKey?: string | null;
  mainWalletPublicKey?: string | null;
  launchTradeBuys?: LaunchTradeBuyRow[];
  ownedBuyVolume?: number;
  ownedSellVolume?: number;
  launchFundingSol?: number;
  launchReturnSol?: number;
};

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

async function setupDashboardPnlTest(
  t: TestContext,
  options: DashboardPnlTestOptions
) {
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

  const tokenPublicKey = TOKEN_PUBLIC_KEY;
  const launch =
    options.launch === undefined
      ? {
          id: `${options.userId}-launch`,
          input: createLaunchInput(),
        }
      : options.launch;
  const mainWalletPublicKey =
    options.mainWalletPublicKey === undefined
      ? DEFAULT_MAIN_WALLET_PUBLIC_KEY
      : options.mainWalletPublicKey;
  const tokenDevWalletPublicKey =
    options.tokenDevWalletPublicKey === undefined
      ? "dev-wallet"
      : options.tokenDevWalletPublicKey;
  const launchTradeBuys = options.launchTradeBuys ?? [];
  const ownedBuyVolume = options.ownedBuyVolume ?? 0;
  const ownedSellVolume = options.ownedSellVolume ?? 0;
  const launchFundingSol = options.launchFundingSol ?? 0;
  const launchReturnSol = options.launchReturnSol ?? 0;

  const { dashboardService, invalidateStatsCache } = await import(
    "./dashboard.service"
  );
  const { prisma } = await import("@/lib/prisma");
  const { priceService } = await import("./price.service");
  const { holdersService } = await import("./holders.service");
  const { testRunLogService } = await import("./test-run-log.service");

  let launchTradeBuyWhere:
    | {
        referenceId?: string;
        walletPublicKey?: string | null;
        source?: string;
        status?: string;
        type?: string;
      }
    | undefined;

  restore(
    t,
    prisma.token as unknown as { findFirst: typeof prisma.token.findFirst },
    "findFirst",
    (async () => ({ publicKey: tokenPublicKey })) as typeof prisma.token.findFirst
  );
  restore(
    t,
    prisma.launch as unknown as { findFirst: typeof prisma.launch.findFirst },
    "findFirst",
    (async (args: Parameters<typeof prisma.launch.findFirst>[0]) => {
      if (args?.select && "completedAt" in args.select) {
        return launch ? { completedAt: new Date("2026-04-07T12:00:00.000Z") } : null;
      }

      return launch;
    }) as typeof prisma.launch.findFirst
  );
  restore(
    t,
    prisma.wallet as unknown as { findMany: typeof prisma.wallet.findMany },
    "findMany",
    (async () => []) as typeof prisma.wallet.findMany
  );
  restore(
    t,
    prisma.tokenDevWallet as unknown as {
      findMany: typeof prisma.tokenDevWallet.findMany;
      findFirst: typeof prisma.tokenDevWallet.findFirst;
    },
    "findMany",
    (async () =>
      tokenDevWalletPublicKey ? [{ walletPublicKey: tokenDevWalletPublicKey }] : []
    ) as typeof prisma.tokenDevWallet.findMany
  );
  restore(
    t,
    prisma.tokenDevWallet as unknown as {
      findMany: typeof prisma.tokenDevWallet.findMany;
      findFirst: typeof prisma.tokenDevWallet.findFirst;
    },
    "findFirst",
    (async () =>
      tokenDevWalletPublicKey
        ? {
            walletPublicKey: tokenDevWalletPublicKey,
          }
        : null) as typeof prisma.tokenDevWallet.findFirst
  );
  restore(
    t,
    prisma.user as unknown as { findUnique: typeof prisma.user.findUnique },
    "findUnique",
    (async () => ({
      mainWalletPublicKey,
    })) as typeof prisma.user.findUnique
  );
  restore(
    t,
    prisma.appTransaction as unknown as {
      groupBy: typeof prisma.appTransaction.groupBy;
      aggregate: typeof prisma.appTransaction.aggregate;
    },
    "groupBy",
    (async () => []) as typeof prisma.appTransaction.groupBy
  );
  restore(
    t,
    prisma.appTransaction as unknown as {
      groupBy: typeof prisma.appTransaction.groupBy;
      aggregate: typeof prisma.appTransaction.aggregate;
    },
    "aggregate",
    (async (args: Parameters<typeof prisma.appTransaction.aggregate>[0]) => {
      const where = args?.where;

      if (where?.type === "TRADE_BUY" && where.source === "LAUNCH") {
        if (typeof where.walletPublicKey === "string") {
          launchTradeBuyWhere = {
            referenceId:
              typeof where.referenceId === "string"
                ? where.referenceId
                : undefined,
            walletPublicKey: where.walletPublicKey,
            source: where.source,
            status: where.status,
            type: where.type,
          };
        }

        const filteredRows = launchTradeBuys.filter(
          (row) =>
            row.userId === where.userId &&
            row.tokenPublicKey === where.tokenPublicKey &&
            row.status === where.status &&
            row.type === where.type &&
            row.source === where.source &&
            row.referenceId === where.referenceId &&
            (typeof where.walletPublicKey === "string"
              ? row.walletPublicKey === where.walletPublicKey
              : true)
        );

        return { _sum: { solAmount: sumSolAmounts(filteredRows) } };
      }

      if (where?.type === "TRANSFER_FUND" && where.source === "LAUNCH") {
        return { _sum: { solAmount: launch ? launchFundingSol : 0 } };
      }

      if (where?.type === "TRANSFER_RETURN" && where.source === "LAUNCH") {
        return { _sum: { solAmount: launch ? launchReturnSol : 0 } };
      }

      return { _sum: { solAmount: 0, jitoTipLamports: 0 } };
    }) as typeof prisma.appTransaction.aggregate
  );
  restore(
    t,
    prisma.tokenTransaction as unknown as {
      groupBy: typeof prisma.tokenTransaction.groupBy;
      count: typeof prisma.tokenTransaction.count;
    },
    "groupBy",
    (async () => {
      return [
        { transactionType: "BUY", _sum: { solAmount: ownedBuyVolume } },
        { transactionType: "SELL", _sum: { solAmount: ownedSellVolume } },
      ];
    }) as typeof prisma.tokenTransaction.groupBy
  );
  restore(
    t,
    prisma.tokenTransaction as unknown as {
      groupBy: typeof prisma.tokenTransaction.groupBy;
      count: typeof prisma.tokenTransaction.count;
      findMany: typeof prisma.tokenTransaction.findMany;
    },
    "count",
    (async () => 0) as typeof prisma.tokenTransaction.count
  );
  restore(
    t,
    prisma.tokenTransaction as unknown as {
      groupBy: typeof prisma.tokenTransaction.groupBy;
      count: typeof prisma.tokenTransaction.count;
      findMany: typeof prisma.tokenTransaction.findMany;
    },
    "findMany",
    (async () => []) as typeof prisma.tokenTransaction.findMany
  );
  restore(
    t,
    prisma.holding as unknown as { findMany: typeof prisma.holding.findMany },
    "findMany",
    (async () => []) as typeof prisma.holding.findMany
  );
  restore(
    t,
    prisma.volumeBotSession as unknown as {
      findMany: typeof prisma.volumeBotSession.findMany;
    },
    "findMany",
    (async () => []) as typeof prisma.volumeBotSession.findMany
  );
  restore(
    t,
    prisma as unknown as { $queryRaw: typeof prisma.$queryRaw },
    "$queryRaw",
    (async () => []) as typeof prisma.$queryRaw
  );
  restore(
    t,
    priceService as unknown as {
      getCurrentPrice: typeof priceService.getCurrentPrice;
      getSolUsdPrice: typeof priceService.getSolUsdPrice;
    },
    "getCurrentPrice",
    (async () => ({
      priceSol: 0.5,
      tokenTotalSupply: 1_000,
      realTokenReserves: 100,
      realSolReserves: 50,
      isComplete: true,
    })) as typeof priceService.getCurrentPrice
  );
  restore(
    t,
    priceService as unknown as {
      getCurrentPrice: typeof priceService.getCurrentPrice;
      getSolUsdPrice: typeof priceService.getSolUsdPrice;
    },
    "getSolUsdPrice",
    (async () => 150) as typeof priceService.getSolUsdPrice
  );
  restore(
    t,
    holdersService as unknown as {
      getCurrentHolders: typeof holdersService.getCurrentHolders;
    },
    "getCurrentHolders",
    (async () => []) as typeof holdersService.getCurrentHolders
  );
  restore(
    t,
    testRunLogService as unknown as {
      appendServerEvent: typeof testRunLogService.appendServerEvent;
    },
    "appendServerEvent",
    (async () => undefined) as typeof testRunLogService.appendServerEvent
  );

  invalidateStatsCache(tokenPublicKey);
  const stats = await dashboardService.getStats(
    { tokenPublicKey },
    options.userId
  );

  invalidateStatsCache(tokenPublicKey);

  return {
    launchTradeBuyWhere,
    stats,
  };
}

test("dashboard P&L only adds back the successful launch dev-wallet buy", async (t) => {
  const userId = "user-dashboard-dev-buy";
  const launchId = "launch-dashboard-dev-buy";
  const devWalletPublicKey = "dev-wallet";

  const launchTradeBuys: LaunchTradeBuyRow[] = [
    {
      userId,
      tokenPublicKey: TOKEN_PUBLIC_KEY,
      status: "CONFIRMED",
      type: "TRADE_BUY",
      source: "LAUNCH",
      referenceId: launchId,
      walletPublicKey: devWalletPublicKey,
      solAmount: 1,
    },
    ...Array.from({ length: 9 }, (_, index) => ({
      userId,
      tokenPublicKey: TOKEN_PUBLIC_KEY,
      status: "CONFIRMED" as const,
      type: "TRADE_BUY" as const,
      source: "LAUNCH" as const,
      referenceId: launchId,
      walletPublicKey: `bundler-wallet-${index + 1}`,
      solAmount: 1,
    })),
  ];

  const { launchTradeBuyWhere, stats } = await setupDashboardPnlTest(t, {
    userId,
    launch: {
      id: launchId,
      input: createLaunchInput("generate"),
    },
    tokenDevWalletPublicKey: devWalletPublicKey,
    launchTradeBuys,
    ownedBuyVolume: 9,
    launchFundingSol: 10.0242,
  });

  assert.deepEqual(launchTradeBuyWhere, {
    referenceId: launchId,
    walletPublicKey: devWalletPublicKey,
    source: "LAUNCH",
    status: "CONFIRMED",
    type: "TRADE_BUY",
  });
  assert.equal(stats.metrics.pnl.totalBuyVolume, 10);
  assert.equal(stats.metrics.pnl.creationCostSol, 0.0242);
});

test("dashboard P&L includes the system dev wallet buy exactly once", async (t) => {
  const userId = "user-dashboard-system-dev";
  const launchId = "launch-dashboard-system-dev";
  const systemDevWalletPublicKey = "system-dev-wallet";

  const { launchTradeBuyWhere, stats } = await setupDashboardPnlTest(t, {
    userId,
    launch: {
      id: launchId,
      input: createLaunchInput("system"),
    },
    tokenDevWalletPublicKey: systemDevWalletPublicKey,
    mainWalletPublicKey: "user-main-wallet",
    launchTradeBuys: [
      {
        userId,
        tokenPublicKey: TOKEN_PUBLIC_KEY,
        status: "CONFIRMED",
        type: "TRADE_BUY",
        source: "LAUNCH",
        referenceId: launchId,
        walletPublicKey: systemDevWalletPublicKey,
        solAmount: 0.1,
      },
    ],
    ownedBuyVolume: 0.9,
  });

  assert.deepEqual(launchTradeBuyWhere, {
    referenceId: launchId,
    walletPublicKey: systemDevWalletPublicKey,
    source: "LAUNCH",
    status: "CONFIRMED",
    type: "TRADE_BUY",
  });
  assert.equal(stats.metrics.pnl.totalBuyVolume, 1);
});

test("dashboard P&L includes the main-wallet dev buy exactly once for use_main launches", async (t) => {
  const userId = "user-dashboard-use-main";
  const launchId = "launch-dashboard-use-main";
  const mainWalletPublicKey = "user-main-wallet";

  const { launchTradeBuyWhere, stats } = await setupDashboardPnlTest(t, {
    userId,
    launch: {
      id: launchId,
      input: createLaunchInput("use_main"),
    },
    tokenDevWalletPublicKey: mainWalletPublicKey,
    mainWalletPublicKey,
    launchTradeBuys: [
      {
        userId,
        tokenPublicKey: TOKEN_PUBLIC_KEY,
        status: "CONFIRMED",
        type: "TRADE_BUY",
        source: "LAUNCH",
        referenceId: launchId,
        walletPublicKey: mainWalletPublicKey,
        solAmount: 0.1,
      },
    ],
    ownedBuyVolume: 0.5,
  });

  assert.deepEqual(launchTradeBuyWhere, {
    referenceId: launchId,
    walletPublicKey: mainWalletPublicKey,
    source: "LAUNCH",
    status: "CONFIRMED",
    type: "TRADE_BUY",
  });
  assert.equal(stats.metrics.pnl.totalBuyVolume, 0.6);
});

test("dashboard P&L only uses the latest successful launch when scoping the dev buy", async (t) => {
  const userId = "user-dashboard-latest-launch";
  const latestLaunchId = "launch-dashboard-latest";
  const oldLaunchId = "launch-dashboard-old";
  const devWalletPublicKey = "dev-wallet";

  const { launchTradeBuyWhere, stats } = await setupDashboardPnlTest(t, {
    userId,
    launch: {
      id: latestLaunchId,
      input: createLaunchInput("generate"),
    },
    tokenDevWalletPublicKey: devWalletPublicKey,
    launchTradeBuys: [
      {
        userId,
        tokenPublicKey: TOKEN_PUBLIC_KEY,
        status: "CONFIRMED",
        type: "TRADE_BUY",
        source: "LAUNCH",
        referenceId: oldLaunchId,
        walletPublicKey: devWalletPublicKey,
        solAmount: 1.5,
      },
      {
        userId,
        tokenPublicKey: TOKEN_PUBLIC_KEY,
        status: "CONFIRMED",
        type: "TRADE_BUY",
        source: "LAUNCH",
        referenceId: latestLaunchId,
        walletPublicKey: devWalletPublicKey,
        solAmount: 0.4,
      },
    ],
    ownedBuyVolume: 0.9,
  });

  assert.deepEqual(launchTradeBuyWhere, {
    referenceId: latestLaunchId,
    walletPublicKey: devWalletPublicKey,
    source: "LAUNCH",
    status: "CONFIRMED",
    type: "TRADE_BUY",
  });
  assert.equal(stats.metrics.pnl.totalBuyVolume, 1.3);
});

test("dashboard P&L falls back to owned buys when no recorded dev wallet exists", async (t) => {
  const { launchTradeBuyWhere, stats } = await setupDashboardPnlTest(t, {
    userId: "user-dashboard-no-dev-wallet",
    launch: {
      id: "launch-dashboard-no-dev-wallet",
      input: createLaunchInput("generate"),
    },
    tokenDevWalletPublicKey: null,
    launchTradeBuys: [
      {
        userId: "user-dashboard-no-dev-wallet",
        tokenPublicKey: TOKEN_PUBLIC_KEY,
        status: "CONFIRMED",
        type: "TRADE_BUY",
        source: "LAUNCH",
        referenceId: "launch-dashboard-no-dev-wallet",
        walletPublicKey: "dev-wallet",
        solAmount: 0.25,
      },
    ],
    ownedBuyVolume: 1.2,
  });

  assert.equal(launchTradeBuyWhere, undefined);
  assert.equal(stats.metrics.pnl.totalBuyVolume, 1.2);
});

test("dashboard P&L falls back to owned buys when no successful launch exists", async (t) => {
  const { launchTradeBuyWhere, stats } = await setupDashboardPnlTest(t, {
    userId: "user-dashboard-no-launch",
    launch: null,
    tokenDevWalletPublicKey: "dev-wallet",
    launchTradeBuys: [
      {
        userId: "user-dashboard-no-launch",
        tokenPublicKey: TOKEN_PUBLIC_KEY,
        status: "CONFIRMED",
        type: "TRADE_BUY",
        source: "LAUNCH",
        referenceId: "launch-dashboard-no-launch",
        walletPublicKey: "dev-wallet",
        solAmount: 0.25,
      },
    ],
    ownedBuyVolume: 0.8,
  });

  assert.equal(launchTradeBuyWhere, undefined);
  assert.equal(stats.metrics.pnl.totalBuyVolume, 0.8);
});
