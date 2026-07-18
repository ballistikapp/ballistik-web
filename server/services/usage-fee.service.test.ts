import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test, { type TestContext } from "node:test";
import {
  Keypair,
  type Connection,
  type Transaction,
} from "@solana/web3.js";
import bs58 from "bs58";
import { Prisma } from "@/lib/prisma";

process.env.DATABASE_URL ??=
  "postgresql://postgres:postgres@127.0.0.1:5432/postgres";

const require = createRequire(import.meta.url);

const USER_ID = "referred-user-1";
const MARKETER_ID = "marketer-1";
const REFERRAL_ID = "referral-1";
const FEE_SOL = 1;
const FEE_LAMPORTS = 1_000_000_000;
const SIGNATURE = "fee-split-signature-111111111111111111111111111111111111";

const platformCollector = Keypair.generate();
const marketerCollector = Keypair.generate();
const sender = Keypair.generate();

process.env.FEE_COLLECTOR_WALLET_ADDRESS = platformCollector.publicKey.toBase58();

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

function stubServerOnlyModule() {
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
}

function parseTransfers(transaction: Transaction) {
  return transaction.instructions.map((instruction) => {
    const toPublicKey = instruction.keys[1]?.pubkey.toBase58() ?? "";
    const amountLamports = Number(instruction.data.readBigUInt64LE(4));
    return { toPublicKey, amountLamports };
  });
}

type ReferralFixture = {
  id: string;
  marketerId: string;
  marketer: {
    isEnabled: boolean;
    feeShareRate: Prisma.Decimal;
    feeCollectorPublicKey: string | null;
  };
} | null;

async function setupUsageFeeTest(
  t: TestContext,
  options: { referral?: ReferralFixture } = {}
) {
  stubServerOnlyModule();

  const usageFeeModule = await import("./usage-fee.service");
  const { prisma } = await import("@/lib/prisma");
  const appTransactionModule = await import(
    "@/server/services/app-transaction.service"
  );
  const testRunLogModule = await import(
    "@/server/services/test-run-log.service"
  );

  const createdPayouts: Array<Record<string, unknown>> = [];
  let sentTransfers: Array<{ toPublicKey: string; amountLamports: number }> =
    [];

  restore(t, prisma.user, "findUnique", (async () => ({
    mainWallet: {
      publicKey: sender.publicKey.toBase58(),
      privateKey: bs58.encode(sender.secretKey),
    },
  })) as unknown as typeof prisma.user.findUnique);

  restore(t, prisma.referral, "findUnique", (async () => {
    return options.referral === undefined ? null : options.referral;
  }) as unknown as typeof prisma.referral.findUnique);

  restore(t, prisma.referralPayout, "create", (async (args: {
    data: Record<string, unknown>;
  }) => {
    createdPayouts.push(args.data);
    return { id: "payout-1", ...args.data };
  }) as unknown as typeof prisma.referralPayout.create);

  restore(
    t,
    usageFeeModule.usageFeeSolana,
    "getConnection",
    (() =>
      ({
        getLatestBlockhash: async () => ({
          blockhash: "Gstestblockhash11111111111111111111111111111",
          lastValidBlockHeight: 123,
        }),
      }) as unknown as Connection) as typeof usageFeeModule.usageFeeSolana.getConnection
  );

  restore(
    t,
    usageFeeModule.usageFeeSolana,
    "sendAndConfirm",
    (async (
      _connection: Connection,
      transaction: Transaction,
      _signers: Keypair[]
    ) => {
      sentTransfers = parseTransfers(transaction);
      return SIGNATURE;
    }) as typeof usageFeeModule.usageFeeSolana.sendAndConfirm
  );

  restore(
    t,
    appTransactionModule.appTransactionService,
    "create",
    (async () => ({ id: "app-tx-1" })) as unknown as typeof appTransactionModule.appTransactionService.create
  );
  restore(
    t,
    appTransactionModule.appTransactionService,
    "confirm",
    (async () => ({})) as unknown as typeof appTransactionModule.appTransactionService.confirm
  );
  restore(
    t,
    appTransactionModule.appTransactionService,
    "fail",
    (async () => ({})) as unknown as typeof appTransactionModule.appTransactionService.fail
  );
  restore(
    t,
    testRunLogModule.testRunLogService,
    "appendServerEvent",
    (async () => ({
      written: false,
      runId: null,
      logPath: null,
    })) as unknown as typeof testRunLogModule.testRunLogService.appendServerEvent
  );

  return {
    usageFeeService: usageFeeModule.usageFeeService,
    createdPayouts,
    getSentTransfers: () => sentTransfers,
  };
}

function qualifyingReferral(rate: number): ReferralFixture {
  return {
    id: REFERRAL_ID,
    marketerId: MARKETER_ID,
    marketer: {
      isEnabled: true,
      feeShareRate: new Prisma.Decimal(rate),
      feeCollectorPublicKey: marketerCollector.publicKey.toBase58(),
    },
  };
}

test("collectFromMainWallet: no Referral sends 100% to platform with no Referral Payout", async (t) => {
  const { usageFeeService, createdPayouts, getSentTransfers } =
    await setupUsageFeeTest(t, { referral: null });

  const result = await usageFeeService.collectFromMainWallet({
    userId: USER_ID,
    totalFeeSol: FEE_SOL,
    reason: "launch.success",
  });

  assert.equal(result.skipped, false);
  assert.equal(result.signature, SIGNATURE);
  assert.deepEqual(getSentTransfers(), [
    {
      toPublicKey: platformCollector.publicKey.toBase58(),
      amountLamports: FEE_LAMPORTS,
    },
  ]);
  assert.equal(createdPayouts.length, 0);
  assert.equal(result.referralPayout, null);
});

test("collectFromMainWallet: qualifying Referral splits Marketer share and platform remainder in one tx", async (t) => {
  const rate = 0.2;
  const { usageFeeService, createdPayouts, getSentTransfers } =
    await setupUsageFeeTest(t, { referral: qualifyingReferral(rate) });

  const result = await usageFeeService.collectFromMainWallet({
    userId: USER_ID,
    totalFeeSol: FEE_SOL,
    reason: "pro.weekly",
  });

  const marketerLamports = 200_000_000;
  const platformLamports = 800_000_000;

  assert.equal(result.skipped, false);
  assert.equal(result.signature, SIGNATURE);
  assert.deepEqual(getSentTransfers(), [
    {
      toPublicKey: marketerCollector.publicKey.toBase58(),
      amountLamports: marketerLamports,
    },
    {
      toPublicKey: platformCollector.publicKey.toBase58(),
      amountLamports: platformLamports,
    },
  ]);
  assert.deepEqual(result.referralPayout, {
    marketerAmountLamports: marketerLamports,
    platformAmountLamports: platformLamports,
    feeShareRate: rate,
  });
  assert.equal(createdPayouts.length, 1);
  assert.equal(createdPayouts[0]?.marketerId, MARKETER_ID);
  assert.equal(createdPayouts[0]?.referralId, REFERRAL_ID);
  assert.equal(createdPayouts[0]?.referredUserId, USER_ID);
  assert.equal(createdPayouts[0]?.marketerAmountLamports, BigInt(marketerLamports));
  assert.equal(createdPayouts[0]?.platformAmountLamports, BigInt(platformLamports));
  assert.equal(createdPayouts[0]?.totalFeeLamports, BigInt(FEE_LAMPORTS));
  assert.equal(Number(createdPayouts[0]?.feeShareRate), rate);
  assert.equal(createdPayouts[0]?.reason, "pro.weekly");
  assert.equal(createdPayouts[0]?.txSignature, SIGNATURE);
});

test("collectFromMainWallet: missing fee-collector keeps 100% platform with no Referral Payout", async (t) => {
  const referral = qualifyingReferral(0.25);
  assert.ok(referral);
  referral.marketer.feeCollectorPublicKey = null;

  const { usageFeeService, createdPayouts, getSentTransfers } =
    await setupUsageFeeTest(t, { referral });

  const result = await usageFeeService.collectFromMainWallet({
    userId: USER_ID,
    totalFeeSol: FEE_SOL,
    reason: "volume-bot.start",
  });

  assert.deepEqual(getSentTransfers(), [
    {
      toPublicKey: platformCollector.publicKey.toBase58(),
      amountLamports: FEE_LAMPORTS,
    },
  ]);
  assert.equal(result.referralPayout, null);
  assert.equal(createdPayouts.length, 0);
});

test("collectFromMainWallet: disabled Marketer keeps 100% platform with no Referral Payout", async (t) => {
  const referral = qualifyingReferral(0.3);
  assert.ok(referral);
  referral.marketer.isEnabled = false;

  const { usageFeeService, createdPayouts, getSentTransfers } =
    await setupUsageFeeTest(t, { referral });

  const result = await usageFeeService.collectFromMainWallet({
    userId: USER_ID,
    totalFeeSol: FEE_SOL,
    reason: "exit.bundled_sell",
  });

  assert.deepEqual(getSentTransfers(), [
    {
      toPublicKey: platformCollector.publicKey.toBase58(),
      amountLamports: FEE_LAMPORTS,
    },
  ]);
  assert.equal(result.referralPayout, null);
  assert.equal(createdPayouts.length, 0);
});

test("collectFromMainWallet: rate 0 or sub-lamport share keeps 100% platform with no Referral Payout", async (t) => {
  const zeroRate = await setupUsageFeeTest(t, {
    referral: qualifyingReferral(0),
  });
  const zeroResult = await zeroRate.usageFeeService.collectFromMainWallet({
    userId: USER_ID,
    totalFeeSol: FEE_SOL,
    reason: "launch.success",
  });
  assert.deepEqual(zeroRate.getSentTransfers(), [
    {
      toPublicKey: platformCollector.publicKey.toBase58(),
      amountLamports: FEE_LAMPORTS,
    },
  ]);
  assert.equal(zeroResult.referralPayout, null);
  assert.equal(zeroRate.createdPayouts.length, 0);

  // 1 lamport total * 0.4 → floors to 0 Marketer lamports
  const tiny = await setupUsageFeeTest(t, {
    referral: qualifyingReferral(0.4),
  });
  const tinyResult = await tiny.usageFeeService.collectFromMainWallet({
    userId: USER_ID,
    totalFeeSol: 0.000000001,
    reason: "launch.success",
  });
  assert.deepEqual(tiny.getSentTransfers(), [
    {
      toPublicKey: platformCollector.publicKey.toBase58(),
      amountLamports: 1,
    },
  ]);
  assert.equal(tinyResult.referralPayout, null);
  assert.equal(tiny.createdPayouts.length, 0);
});

test("collectFromMainWallet: floors Marketer share without float drift", async (t) => {
  // 100 lamports * 0.29 must be 29 (not 28 from IEEE float floor)
  const { usageFeeService, getSentTransfers } = await setupUsageFeeTest(t, {
    referral: qualifyingReferral(0.29),
  });

  await usageFeeService.collectFromMainWallet({
    userId: USER_ID,
    totalFeeSol: 0.0000001,
    reason: "launch.success",
  });

  assert.deepEqual(getSentTransfers(), [
    {
      toPublicKey: marketerCollector.publicKey.toBase58(),
      amountLamports: 29,
    },
    {
      toPublicKey: platformCollector.publicKey.toBase58(),
      amountLamports: 71,
    },
  ]);
});

test("collectFromMainWallet: live Marketer rate applies on the next collection", async (t) => {
  const first = await setupUsageFeeTest(t, {
    referral: qualifyingReferral(0.1),
  });
  await first.usageFeeService.collectFromMainWallet({
    userId: USER_ID,
    totalFeeSol: FEE_SOL,
    reason: "launch.success",
  });
  assert.deepEqual(first.getSentTransfers(), [
    {
      toPublicKey: marketerCollector.publicKey.toBase58(),
      amountLamports: 100_000_000,
    },
    {
      toPublicKey: platformCollector.publicKey.toBase58(),
      amountLamports: 900_000_000,
    },
  ]);

  const second = await setupUsageFeeTest(t, {
    referral: qualifyingReferral(0.5),
  });
  await second.usageFeeService.collectFromMainWallet({
    userId: USER_ID,
    totalFeeSol: FEE_SOL,
    reason: "launch.success",
  });
  assert.deepEqual(second.getSentTransfers(), [
    {
      toPublicKey: marketerCollector.publicKey.toBase58(),
      amountLamports: 500_000_000,
    },
    {
      toPublicKey: platformCollector.publicKey.toBase58(),
      amountLamports: 500_000_000,
    },
  ]);
  assert.equal(second.createdPayouts[0]?.feeShareRate?.toString(), "0.5");
});
