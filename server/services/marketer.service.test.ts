import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test, { type TestContext } from "node:test";

process.env.DATABASE_URL ??=
  "postgresql://postgres:postgres@127.0.0.1:5432/postgres";

const require = createRequire(import.meta.url);

const MARKETER_USER_ID = "marketer-user-1";
const MARKETER_ID = "marketer-1";
const REFERRED_USER_A = "referred-user-a";
const REFERRED_USER_B = "referred-user-b";

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

async function setupMarketerTest(t: TestContext) {
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

  const { marketerService } = await import("./marketer.service");
  const { prisma } = await import("@/lib/prisma");

  return { marketerService, prisma };
}

function stubMarketer(
  t: TestContext,
  prisma: Awaited<ReturnType<typeof setupMarketerTest>>["prisma"],
  opts: { isEnabled?: boolean } = {}
) {
  restore(
    t,
    prisma.marketer,
    "findUnique",
    (async () => ({
      id: MARKETER_ID,
      isEnabled: opts.isEnabled ?? true,
      referralCode: "promo",
      feeCollectorPublicKey: "Collector111111111111111111111111111111111",
    })) as unknown as typeof prisma.marketer.findUnique
  );
}

test("listReferredUsers projects zero payout stats when a referred User never paid", async (t) => {
  const { marketerService, prisma } = await setupMarketerTest(t);
  stubMarketer(t, prisma);

  restore(
    t,
    prisma.referral,
    "findMany",
    (async () => [
      {
        id: "referral-a",
        createdAt: new Date("2026-07-20T12:00:00.000Z"),
        user: {
          id: REFERRED_USER_A,
          name: "Alice",
          mainWalletPublicKey: "AliceWallet1111111111111111111111111111111",
        },
      },
    ]) as unknown as typeof prisma.referral.findMany
  );

  restore(
    t,
    prisma.referralPayout,
    "findMany",
    (async () => []) as unknown as typeof prisma.referralPayout.findMany
  );

  const rows = await marketerService.listReferredUsers(MARKETER_USER_ID);

  assert.deepEqual(rows, [
    {
      referralId: "referral-a",
      userId: REFERRED_USER_A,
      name: "Alice",
      mainWalletPublicKey: "AliceWallet1111111111111111111111111111111",
      joinedAt: new Date("2026-07-20T12:00:00.000Z"),
      totalEarnedLamports: BigInt(0),
      lastPayoutAt: null,
      payoutCount: 0,
    },
  ]);
});

test("listReferredUsers aggregates Referral Payouts per referred User", async (t) => {
  const { marketerService, prisma } = await setupMarketerTest(t);
  stubMarketer(t, prisma);

  // Known Referral Payout fixtures (literal worked example):
  // Bob: 1.0 SOL + 0.5 SOL → 1.5 SOL earned, 2 payouts, last at 15:30
  // Alice: no payouts
  const payoutFixtures = [
    {
      referredUserId: REFERRED_USER_B,
      marketerAmountLamports: BigInt(1_000_000_000),
      createdAt: new Date("2026-07-21T14:00:00.000Z"),
    },
    {
      referredUserId: REFERRED_USER_B,
      marketerAmountLamports: BigInt(500_000_000),
      createdAt: new Date("2026-07-22T15:30:00.000Z"),
    },
  ];

  restore(
    t,
    prisma.referral,
    "findMany",
    (async () => [
      {
        id: "referral-b",
        createdAt: new Date("2026-07-21T10:00:00.000Z"),
        user: {
          id: REFERRED_USER_B,
          name: "Bob",
          mainWalletPublicKey: "BobWallet111111111111111111111111111111111",
        },
      },
      {
        id: "referral-a",
        createdAt: new Date("2026-07-20T12:00:00.000Z"),
        user: {
          id: REFERRED_USER_A,
          name: "Alice",
          mainWalletPublicKey: "AliceWallet1111111111111111111111111111111",
        },
      },
    ]) as unknown as typeof prisma.referral.findMany
  );

  restore(
    t,
    prisma.referralPayout,
    "findMany",
    (async () => payoutFixtures) as unknown as typeof prisma.referralPayout.findMany
  );

  const rows = await marketerService.listReferredUsers(MARKETER_USER_ID);

  assert.deepEqual(rows, [
    {
      referralId: "referral-b",
      userId: REFERRED_USER_B,
      name: "Bob",
      mainWalletPublicKey: "BobWallet111111111111111111111111111111111",
      joinedAt: new Date("2026-07-21T10:00:00.000Z"),
      totalEarnedLamports: BigInt(1_500_000_000),
      lastPayoutAt: new Date("2026-07-22T15:30:00.000Z"),
      payoutCount: 2,
    },
    {
      referralId: "referral-a",
      userId: REFERRED_USER_A,
      name: "Alice",
      mainWalletPublicKey: "AliceWallet1111111111111111111111111111111",
      joinedAt: new Date("2026-07-20T12:00:00.000Z"),
      totalEarnedLamports: BigInt(0),
      lastPayoutAt: null,
      payoutCount: 0,
    },
  ]);
});

test("listReferredUsers includes payout stats for disabled Marketers", async (t) => {
  const { marketerService, prisma } = await setupMarketerTest(t);
  stubMarketer(t, prisma, { isEnabled: false });

  restore(
    t,
    prisma.referral,
    "findMany",
    (async () => [
      {
        id: "referral-b",
        createdAt: new Date("2026-07-21T10:00:00.000Z"),
        user: {
          id: REFERRED_USER_B,
          name: "Bob",
          mainWalletPublicKey: "BobWallet111111111111111111111111111111111",
        },
      },
    ]) as unknown as typeof prisma.referral.findMany
  );

  restore(
    t,
    prisma.referralPayout,
    "findMany",
    (async () => [
      {
        referredUserId: REFERRED_USER_B,
        marketerAmountLamports: BigInt(250_000_000),
        createdAt: new Date("2026-07-22T09:00:00.000Z"),
      },
    ]) as unknown as typeof prisma.referralPayout.findMany
  );

  const rows = await marketerService.listReferredUsers(MARKETER_USER_ID);

  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.totalEarnedLamports, BigInt(250_000_000));
  assert.deepEqual(
    rows[0]?.lastPayoutAt,
    new Date("2026-07-22T09:00:00.000Z")
  );
  assert.equal(rows[0]?.payoutCount, 1);
});
