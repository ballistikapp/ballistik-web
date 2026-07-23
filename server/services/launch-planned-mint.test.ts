import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test, { type TestContext } from "node:test";

process.env.DATABASE_URL ??=
  "postgresql://postgres:postgres@127.0.0.1:5432/postgres";

const require = createRequire(import.meta.url);

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

function restore<T extends object, K extends keyof T>(
  t: TestContext,
  target: T,
  key: K,
  impl: T[K]
) {
  const original = target[key];
  target[key] = impl;
  t.after(() => {
    target[key] = original;
  });
}

test("createLaunchPlannedMint persists mint identity for a Launch", async (t) => {
  stubServerOnlyModule();
  const { prisma } = await import("@/lib/prisma");
  const { createLaunchPlannedMint } = await import("./launch-planned-mint");

  restore(t, prisma.launchPlannedMint, "create", (async (args: {
    data: {
      launchId: string;
      publicKey: string;
      privateKey: string;
      vanityMintId: string | null;
    };
  }) => ({
    id: "planned-1",
    launchId: args.data.launchId,
    publicKey: args.data.publicKey,
    privateKey: args.data.privateKey,
    vanityMintId: args.data.vanityMintId,
    consumedAt: null,
    abandonedAt: null,
  })) as unknown as typeof prisma.launchPlannedMint.create);

  const created = await createLaunchPlannedMint({
    launchId: "launch-1",
    publicKey: "Mint111111111111111111111111111111111111111",
    privateKey: "secret",
    vanityMintId: null,
  });

  assert.equal(created.id, "planned-1");
  assert.equal(created.publicKey, "Mint111111111111111111111111111111111111111");
  assert.equal(created.vanityMintId, null);
});

test("requireActiveLaunchPlannedMint rejects abandoned rows", async (t) => {
  stubServerOnlyModule();
  const { prisma } = await import("@/lib/prisma");
  const { isAppError } = await import("@/server/errors");
  const { requireActiveLaunchPlannedMint } = await import(
    "./launch-planned-mint"
  );

  restore(t, prisma.launchPlannedMint, "findUnique", (async () => ({
    id: "planned-1",
    launchId: "launch-1",
    publicKey: "Mint111111111111111111111111111111111111111",
    privateKey: "secret",
    vanityMintId: null,
    consumedAt: null,
    abandonedAt: new Date("2026-07-23T00:00:00.000Z"),
  })) as unknown as typeof prisma.launchPlannedMint.findUnique);

  await assert.rejects(
    () => requireActiveLaunchPlannedMint("planned-1"),
    (error: unknown) =>
      isAppError(error) && /abandoned/i.test(error.message)
  );
});

test("abandonLaunchPlannedMint marks abandoned and returns vanityMintId", async (t) => {
  stubServerOnlyModule();
  const { prisma } = await import("@/lib/prisma");
  const { abandonLaunchPlannedMint } = await import("./launch-planned-mint");

  restore(t, prisma.launchPlannedMint, "findUnique", (async () => ({
    id: "planned-1",
    vanityMintId: "vanity-1",
    consumedAt: null,
    abandonedAt: null,
  })) as unknown as typeof prisma.launchPlannedMint.findUnique);

  restore(t, prisma.launchPlannedMint, "update", (async () => ({
    vanityMintId: "vanity-1",
  })) as unknown as typeof prisma.launchPlannedMint.update);

  const result = await abandonLaunchPlannedMint("planned-1");
  assert.equal(result.vanityMintId, "vanity-1");
});
