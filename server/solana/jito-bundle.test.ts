import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  type Connection,
} from "@solana/web3.js";
import type {
  BundleTelemetryEvent,
  JitoSubmissionAdapters,
} from "./jito-bundle";

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

async function loadSendJitoBundle() {
  stubServerOnlyModule();
  const { sendJitoBundleForTests } = await import("./jito-bundle");
  return sendJitoBundleForTests;
}

function buildLegacyTransferTx(feePayer: Keypair, to: PublicKey) {
  const tx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: feePayer.publicKey,
      toPubkey: to,
      lamports: 1_000,
    })
  );
  tx.feePayer = feePayer.publicKey;
  return tx;
}

function fakeConnection(overrides: {
  simulateTransaction: Connection["simulateTransaction"];
  getSignatureStatuses?: Connection["getSignatureStatuses"];
}): Connection {
  return {
    rpcEndpoint: "https://example.invalid",
    getLatestBlockhash: async () => ({
      blockhash: "11111111111111111111111111111111",
      lastValidBlockHeight: 1,
    }),
    simulateTransaction: overrides.simulateTransaction,
    getSignatureStatuses:
      overrides.getSignatureStatuses ??
      (async () => ({ value: [null] }) as never),
  } as unknown as Connection;
}

test("does not send a bundle after authoritative first-tx simulation failure", async () => {
  const sendJitoBundle = await loadSendJitoBundle();
  let sendBundleCalls = 0;
  const feePayer = Keypair.generate();
  const tipper = Keypair.generate();
  const tipAccount = Keypair.generate().publicKey;
  const txs = [buildLegacyTransferTx(feePayer, tipAccount)];
  const signers = [[feePayer]];

  const adapters: JitoSubmissionAdapters = {
    getConnection: () =>
      fakeConnection({
        simulateTransaction: async () =>
          ({
            value: {
              err: { InstructionError: [0, "Custom"] },
              unitsConsumed: 12_345,
              logs: ["program failed"],
            },
          }) as never,
      }),
    getTipAccount: async () => tipAccount,
    sendBundle: async () => {
      sendBundleCalls += 1;
      return {
        ok: true as const,
        value: "should-not-send",
        endpoint: "https://example.invalid",
        rejections: [],
      };
    },
    simulateBundleSequentially: async () => ({
      status: "unsupported",
      error: "not used",
    }),
  };

  await assert.rejects(
    () => sendJitoBundle(txs, signers, tipper, 0, { adapters }),
    /simulation failed/i
  );
  assert.equal(sendBundleCalls, 0);
});

test("does not send a bundle after authoritative sequential simulation failure", async () => {
  const sendJitoBundle = await loadSendJitoBundle();
  let sendBundleCalls = 0;
  const feePayer = Keypair.generate();
  const tipper = Keypair.generate();
  const tipAccount = Keypair.generate().publicKey;
  const txs = [buildLegacyTransferTx(feePayer, tipAccount)];
  const signers = [[feePayer]];

  const adapters: JitoSubmissionAdapters = {
    getConnection: () =>
      fakeConnection({
        simulateTransaction: async () =>
          ({
            value: {
              err: null,
              unitsConsumed: 50_000,
              logs: ["ok"],
            },
          }) as never,
      }),
    getTipAccount: async () => tipAccount,
    sendBundle: async () => {
      sendBundleCalls += 1;
      return {
        ok: true as const,
        value: "should-not-send",
        endpoint: "https://example.invalid",
        rejections: [],
      };
    },
    simulateBundleSequentially: async () => ({
      status: "ok",
      summaryError: "buy failed",
      failingTxIndex: 0,
      transactionResults: [
        {
          txIndex: 0,
          err: "Custom",
          logs: ["buy failed"],
          unitsConsumed: 1,
        },
      ],
    }),
  };

  await assert.rejects(
    () => sendJitoBundle(txs, signers, tipper, 0, { adapters }),
    /sequential simulation failed/i
  );
  assert.equal(sendBundleCalls, 0);
});

test("accepted bundle returns signatures, confirmation evidence, and structured telemetry", async () => {
  const sendJitoBundle = await loadSendJitoBundle();
  const feePayer = Keypair.generate();
  const tipper = Keypair.generate();
  const tipAccount = Keypair.generate().publicKey;
  const txs = [buildLegacyTransferTx(feePayer, tipAccount)];
  const signers = [[feePayer]];
  const streamed: BundleTelemetryEvent[] = [];
  const endpoint = "https://ny.mainnet.block-engine.jito.wtf";

  const adapters: JitoSubmissionAdapters = {
    getConnection: () =>
      fakeConnection({
        simulateTransaction: async () =>
          ({
            value: {
              err: null,
              unitsConsumed: 50_000,
              logs: ["ok"],
            },
          }) as never,
        getSignatureStatuses: async () =>
          ({
            value: [
              {
                slot: 99,
                confirmations: 32,
                err: null,
                confirmationStatus: "confirmed",
              },
            ],
          }) as never,
      }),
    getTipAccount: async () => tipAccount,
    sendBundle: async () => ({
      ok: true as const,
      value: "bundle-abc",
      endpoint,
      rejections: [],
    }),
    getInflightBundleStatuses: async () => ({
      ok: true as const,
      value: {
        contextSlot: 99,
        bundles: [
          {
            bundleId: "bundle-abc",
            status: "Landed" as const,
            landedSlot: 100,
          },
        ],
      },
      endpoint,
      matchedPreferred: true,
    }),
    getBundleStatuses: async () => ({
      ok: true as const,
      value: { contextSlot: 99, bundles: [] },
      endpoint,
    }),
    simulateBundleSequentially: async () => ({
      status: "ok",
      summaryError: null,
      failingTxIndex: null,
      transactionResults: [
        { txIndex: 0, err: null, logs: ["ok"], unitsConsumed: 50_000 },
      ],
    }),
  };

  const result = await sendJitoBundle(txs, signers, tipper, 0, {
    enableGrpc: false,
    adapters,
    onEvent: (event) => {
      streamed.push(event);
    },
  });

  assert.equal(result.bundleId, "bundle-abc");
  assert.equal(result.signatures.length, 1);
  assert.ok(result.signatures[0]);
  assert.equal(result.confirmation.bundleId, "bundle-abc");
  assert.equal(result.confirmation.endpoint, endpoint);
  assert.equal(result.confirmation.source, "inflight");
  assert.equal(result.confirmation.landedSlot, 100);
  assert.equal(result.confirmation.tipLamports, 0);
  assert.ok(Array.isArray(result.telemetry));
  assert.ok(result.telemetry.length > 0);
  assert.ok(result.telemetry.some((event) => event.type === "bundle_sent"));
  assert.ok(streamed.some((event) => event.type === "bundle_sent"));
  assert.equal(
    Object.prototype.hasOwnProperty.call(result, "appTransactions"),
    false
  );
});
