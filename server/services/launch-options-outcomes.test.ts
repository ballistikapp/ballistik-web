import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test, { type TestContext } from "node:test";
import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";

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

test("materializeLaunchOptionsOutcomes always returns mintPublicKey and plannedMintId for fresh mints", async (t) => {
  stubServerOnlyModule();
  const { prisma } = await import("@/lib/prisma");

  restore(t, prisma.launchPlannedMint, "create", (async (args: {
    data: {
      launchId: string;
      publicKey: string;
      privateKey: string;
      vanityMintId: string | null;
    };
  }) => ({
    id: "planned-fresh-1",
    launchId: args.data.launchId,
    publicKey: args.data.publicKey,
    privateKey: args.data.privateKey,
    vanityMintId: args.data.vanityMintId,
    consumedAt: null,
    abandonedAt: null,
  })) as unknown as typeof prisma.launchPlannedMint.create);

  const { materializeLaunchOptionsOutcomes } = await import(
    "./launch-options-outcomes"
  );
  const result = await materializeLaunchOptionsOutcomes({
    launchId: "launch-1",
    userId: "user-1",
    options: { vanityMint: false, removeAttribution: true },
  });

  assert.equal(result.optionsOutcomes.vanityMint, false);
  assert.equal(result.optionsOutcomes.removeAttribution, true);
  assert.equal(result.optionsOutcomes.plannedMintId, "planned-fresh-1");
  assert.ok(result.optionsOutcomes.mintPublicKey.length > 0);
  assert.equal(result.optionsOutcomes.reservedVanityMintId, null);
  assert.equal(result.localResources.plannedMintId, "planned-fresh-1");
});

test("compensateLaunchOptionsResources abandons planned mint and releases vanity", async (t) => {
  stubServerOnlyModule();
  const { prisma } = await import("@/lib/prisma");
  const events: string[] = [];

  restore(t, prisma.launchPlannedMint, "findUnique", (async () => ({
    id: "planned-1",
    vanityMintId: "vanity-1",
    consumedAt: null,
    abandonedAt: null,
  })) as unknown as typeof prisma.launchPlannedMint.findUnique);

  restore(t, prisma.launchPlannedMint, "update", (async (args: {
    where: { id: string };
  }) => {
    events.push(`abandon:${args.where.id}`);
    return { vanityMintId: "vanity-1" };
  }) as unknown as typeof prisma.launchPlannedMint.update);

  restore(t, prisma.vanityMint, "updateMany", (async (args: {
    where: { id: string };
  }) => {
    events.push(`release:${args.where.id}`);
    return { count: 1 };
  }) as unknown as typeof prisma.vanityMint.updateMany);

  const { compensateLaunchOptionsResources } = await import(
    "./launch-options-outcomes"
  );
  await compensateLaunchOptionsResources({
    plannedMintId: "planned-1",
    reservedVanityMintId: "vanity-1",
  });

  assert.deepEqual(events, ["abandon:planned-1", "release:vanity-1"]);
});

test("resolveMintKeypairFromOptionsOutcomes loads only via plannedMintId", async (t) => {
  stubServerOnlyModule();
  const keypair = Keypair.generate();
  const publicKey = keypair.publicKey.toBase58();
  const privateKey = bs58.encode(keypair.secretKey);
  const { prisma } = await import("@/lib/prisma");

  restore(t, prisma.launchPlannedMint, "findUnique", (async () => ({
    id: "planned-1",
    launchId: "launch-1",
    publicKey,
    privateKey,
    vanityMintId: null,
    consumedAt: null,
    abandonedAt: null,
  })) as unknown as typeof prisma.launchPlannedMint.findUnique);

  const { resolveMintKeypairFromOptionsOutcomes } = await import(
    "./launch.service"
  );
  const resolved = await resolveMintKeypairFromOptionsOutcomes({
    launchId: "launch-1",
    userId: "user-1",
    optionsOutcomes: {
      vanityMint: false,
      removeAttribution: false,
      mintPublicKey: publicKey,
      plannedMintId: "planned-1",
      reservedVanityMintId: null,
    },
  });

  assert.equal(resolved.mintKeypair.publicKey.toBase58(), publicKey);
  assert.equal(resolved.reservedVanityId, null);
});
