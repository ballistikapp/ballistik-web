import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test, { type TestContext } from "node:test";
import { isAppError } from "@/server/errors";

process.env.DATABASE_URL ??=
  "postgresql://postgres:postgres@127.0.0.1:5432/postgres";

const require = createRequire(import.meta.url);

const USER_ID = "applicant-user";
const OPERATOR_ID = "operator-user";
const APPLICATION_ID = "application-1";

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

async function setupApplicationTest(t: TestContext) {
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

  const { marketerApplicationService } = await import(
    "./marketer-application.service"
  );
  const { opsService } = await import("./ops.service");
  const { prisma } = await import("@/lib/prisma");

  restore(t, prisma.user, "findUnique", (async (args: {
    where: { id?: string };
    select?: { isOperator?: boolean; marketer?: unknown };
  }) => {
    if (args.where.id === OPERATOR_ID) {
      return { isOperator: true };
    }
    if (args.where.id === USER_ID) {
      return {
        id: USER_ID,
        name: "Applicant",
        mainWalletPublicKey: "MainWallet111111111111111111111111111111111",
        marketer: null,
        isOperator: false,
      };
    }
    return null;
  }) as unknown as typeof prisma.user.findUnique);

  return { marketerApplicationService, opsService, prisma };
}

test("submitApplication creates a pending Marketer Application", async (t) => {
  const { marketerApplicationService, prisma } = await setupApplicationTest(t);
  let createdData: unknown;

  restore(t, prisma.marketer, "findUnique", (async () => null) as unknown as typeof prisma.marketer.findUnique);
  restore(
    t,
    prisma.marketerApplication,
    "findFirst",
    (async () => null) as unknown as typeof prisma.marketerApplication.findFirst
  );
  restore(
    t,
    prisma.marketerApplication,
    "create",
    (async (args: { data: { userId: string; message: string; status: string } }) => {
      createdData = args.data;
      return {
        id: APPLICATION_ID,
        userId: args.data.userId,
        message: args.data.message,
        operatorNote: null,
        status: "PENDING",
        createdAt: new Date("2026-07-23T10:00:00.000Z"),
        updatedAt: new Date("2026-07-23T10:00:00.000Z"),
      };
    }) as unknown as typeof prisma.marketerApplication.create
  );

  const result = await marketerApplicationService.submitApplication(USER_ID, {
    message: "I want to promote Ballistik",
  });

  assert.equal(result.status, "PENDING");
  assert.equal(result.message, "I want to promote Ballistik");
  assert.deepEqual(createdData, {
    userId: USER_ID,
    message: "I want to promote Ballistik",
    status: "PENDING",
  });
});

test("submitApplication rejects when a pending Application already exists", async (t) => {
  const { marketerApplicationService, prisma } = await setupApplicationTest(t);

  restore(t, prisma.marketer, "findUnique", (async () => null) as unknown as typeof prisma.marketer.findUnique);
  restore(
    t,
    prisma.marketerApplication,
    "findFirst",
    (async () => ({
      id: APPLICATION_ID,
      status: "PENDING",
    })) as unknown as typeof prisma.marketerApplication.findFirst
  );

  await assert.rejects(
    () =>
      marketerApplicationService.submitApplication(USER_ID, {
        message: "Second try",
      }),
    (error: unknown) =>
      isAppError(error) &&
      error.statusCode === 400 &&
      error.message === "A Marketer Application is already pending"
  );
});

test("submitApplication rejects when the User is already a Marketer", async (t) => {
  const { marketerApplicationService, prisma } = await setupApplicationTest(t);

  restore(
    t,
    prisma.marketer,
    "findUnique",
    (async () => ({ id: "marketer-1" })) as unknown as typeof prisma.marketer.findUnique
  );
  restore(
    t,
    prisma.marketerApplication,
    "findFirst",
    (async () => null) as unknown as typeof prisma.marketerApplication.findFirst
  );

  await assert.rejects(
    () =>
      marketerApplicationService.submitApplication(USER_ID, {
        message: "Please",
      }),
    (error: unknown) =>
      isAppError(error) &&
      error.statusCode === 400 &&
      error.message === "Already a Marketer"
  );
});

test("submitApplication allows a new Application after reject", async (t) => {
  const { marketerApplicationService, prisma } = await setupApplicationTest(t);
  let created = false;

  restore(t, prisma.marketer, "findUnique", (async () => null) as unknown as typeof prisma.marketer.findUnique);
  restore(
    t,
    prisma.marketerApplication,
    "findFirst",
    (async () => null) as unknown as typeof prisma.marketerApplication.findFirst
  );
  restore(
    t,
    prisma.marketerApplication,
    "create",
    (async (args: { data: { message: string } }) => {
      created = true;
      return {
        id: "application-2",
        userId: USER_ID,
        message: args.data.message,
        operatorNote: null,
        status: "PENDING",
        createdAt: new Date("2026-07-23T12:00:00.000Z"),
        updatedAt: new Date("2026-07-23T12:00:00.000Z"),
      };
    }) as unknown as typeof prisma.marketerApplication.create
  );

  const result = await marketerApplicationService.submitApplication(USER_ID, {
    message: "Trying again after reject",
  });

  assert.equal(created, true);
  assert.equal(result.id, "application-2");
  assert.equal(result.status, "PENDING");
});

test("rejectApplication sets REJECTED and optional operator note", async (t) => {
  const { marketerApplicationService, prisma } = await setupApplicationTest(t);
  let updateData: unknown;

  restore(
    t,
    prisma.marketerApplication,
    "findUnique",
    (async () => ({
      id: APPLICATION_ID,
      status: "PENDING",
    })) as unknown as typeof prisma.marketerApplication.findUnique
  );
  restore(
    t,
    prisma.marketerApplication,
    "update",
    (async (args: {
      data: { status: string; operatorNote?: string | null };
    }) => {
      updateData = args.data;
      return {
        id: APPLICATION_ID,
        userId: USER_ID,
        message: "I want in",
        operatorNote: args.data.operatorNote ?? null,
        status: "REJECTED",
        createdAt: new Date("2026-07-23T10:00:00.000Z"),
        updatedAt: new Date("2026-07-23T11:00:00.000Z"),
      };
    }) as unknown as typeof prisma.marketerApplication.update
  );

  const result = await marketerApplicationService.rejectApplication(
    OPERATOR_ID,
    {
      applicationId: APPLICATION_ID,
      operatorNote: "Need more detail",
    }
  );

  assert.equal(result.status, "REJECTED");
  assert.equal(result.operatorNote, "Need more detail");
  assert.deepEqual(updateData, {
    status: "REJECTED",
    operatorNote: "Need more detail",
  });
});

test("approvePendingForUser approves the pending Application", async (t) => {
  const { marketerApplicationService, prisma } = await setupApplicationTest(t);
  let updatedId: string | undefined;

  restore(
    t,
    prisma.marketerApplication,
    "findFirst",
    (async () => ({ id: APPLICATION_ID })) as unknown as typeof prisma.marketerApplication.findFirst
  );
  restore(
    t,
    prisma.marketerApplication,
    "update",
    (async (args: { where: { id: string }; data: { status: string } }) => {
      updatedId = args.where.id;
      assert.equal(args.data.status, "APPROVED");
      return {
        id: APPLICATION_ID,
        userId: USER_ID,
        message: "I want in",
        operatorNote: null,
        status: "APPROVED",
        createdAt: new Date("2026-07-23T10:00:00.000Z"),
        updatedAt: new Date("2026-07-23T11:30:00.000Z"),
      };
    }) as unknown as typeof prisma.marketerApplication.update
  );

  const result =
    await marketerApplicationService.approvePendingForUser(USER_ID);

  assert.equal(updatedId, APPLICATION_ID);
  assert.equal(result?.status, "APPROVED");
});

test("approvePendingForUser is a no-op when no pending Application exists", async (t) => {
  const { marketerApplicationService, prisma } = await setupApplicationTest(t);
  let updateCalled = false;

  restore(
    t,
    prisma.marketerApplication,
    "findFirst",
    (async () => null) as unknown as typeof prisma.marketerApplication.findFirst
  );
  restore(
    t,
    prisma.marketerApplication,
    "update",
    (async () => {
      updateCalled = true;
      throw new Error("should not update");
    }) as unknown as typeof prisma.marketerApplication.update
  );

  const result =
    await marketerApplicationService.approvePendingForUser(USER_ID);

  assert.equal(result, null);
  assert.equal(updateCalled, false);
});

test("createMarketer auto-approves the User's pending Application", async (t) => {
  const { opsService, prisma } = await setupApplicationTest(t);
  let approvedApplicationId: string | undefined;
  let createdMarketer = false;

  restore(
    t,
    prisma,
    "$transaction",
    (async (fn: (tx: typeof prisma) => Promise<unknown>) =>
      fn(prisma)) as unknown as typeof prisma.$transaction
  );

  restore(
    t,
    prisma.marketer,
    "create",
    (async (args: {
      data: {
        userId: string;
        nickname: string;
        feeShareRate: number;
        isEnabled?: boolean;
      };
    }) => {
      createdMarketer = true;
      return {
        id: "marketer-1",
        userId: args.data.userId,
        nickname: args.data.nickname,
        feeShareRate: args.data.feeShareRate,
        isEnabled: args.data.isEnabled ?? true,
        referralCode: null,
        feeCollectorPublicKey: null,
        createdAt: new Date("2026-07-23T12:00:00.000Z"),
        updatedAt: new Date("2026-07-23T12:00:00.000Z"),
        user: {
          id: USER_ID,
          name: "Applicant",
          mainWalletPublicKey: "MainWallet111111111111111111111111111111111",
        },
      };
    }) as unknown as typeof prisma.marketer.create
  );

  restore(
    t,
    prisma.marketerApplication,
    "findFirst",
    (async () => ({ id: APPLICATION_ID })) as unknown as typeof prisma.marketerApplication.findFirst
  );
  restore(
    t,
    prisma.marketerApplication,
    "update",
    (async (args: { where: { id: string }; data: { status: string } }) => {
      approvedApplicationId = args.where.id;
      assert.equal(args.data.status, "APPROVED");
      return {
        id: APPLICATION_ID,
        userId: USER_ID,
        message: "I want in",
        operatorNote: null,
        status: "APPROVED",
        createdAt: new Date("2026-07-23T10:00:00.000Z"),
        updatedAt: new Date("2026-07-23T12:00:00.000Z"),
      };
    }) as unknown as typeof prisma.marketerApplication.update
  );

  const result = await opsService.createMarketer(OPERATOR_ID, {
    userId: USER_ID,
    nickname: "promo-alice",
    feeShareRate: 0.1,
  });

  assert.equal(createdMarketer, true);
  assert.equal(result.nickname, "promo-alice");
  assert.equal(approvedApplicationId, APPLICATION_ID);
});

test("createMarketer with no pending Application leaves Applications untouched", async (t) => {
  const { opsService, prisma } = await setupApplicationTest(t);
  let applicationUpdateCalled = false;

  restore(
    t,
    prisma,
    "$transaction",
    (async (fn: (tx: typeof prisma) => Promise<unknown>) =>
      fn(prisma)) as unknown as typeof prisma.$transaction
  );

  restore(
    t,
    prisma.marketer,
    "create",
    (async (args: {
      data: {
        userId: string;
        nickname: string;
        feeShareRate: number;
        isEnabled?: boolean;
      };
    }) => ({
      id: "marketer-2",
      userId: args.data.userId,
      nickname: args.data.nickname,
      feeShareRate: args.data.feeShareRate,
      isEnabled: args.data.isEnabled ?? true,
      referralCode: null,
      feeCollectorPublicKey: null,
      createdAt: new Date("2026-07-23T12:00:00.000Z"),
      updatedAt: new Date("2026-07-23T12:00:00.000Z"),
      user: {
        id: USER_ID,
        name: "Applicant",
        mainWalletPublicKey: "MainWallet111111111111111111111111111111111",
      },
    })) as unknown as typeof prisma.marketer.create
  );

  restore(
    t,
    prisma.marketerApplication,
    "findFirst",
    (async () => null) as unknown as typeof prisma.marketerApplication.findFirst
  );
  restore(
    t,
    prisma.marketerApplication,
    "update",
    (async () => {
      applicationUpdateCalled = true;
      throw new Error("should not update applications");
    }) as unknown as typeof prisma.marketerApplication.update
  );

  await opsService.createMarketer(OPERATOR_ID, {
    userId: USER_ID,
    nickname: "direct-bob",
    feeShareRate: 0.15,
  });

  assert.equal(applicationUpdateCalled, false);
});
