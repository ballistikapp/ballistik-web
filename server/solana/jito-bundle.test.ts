import assert from "node:assert/strict";
import test from "node:test";
import {
  Keypair,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { profileVersionedTransactions } from "./jito-bundle";

function buildVersionedTransaction(instructionCount: number) {
  const payer = Keypair.generate();
  const instructions = Array.from({ length: instructionCount }, (_, index) => {
    return new TransactionInstruction({
      programId: Keypair.generate().publicKey,
      keys: [],
      data: Buffer.from([index]),
    });
  });
  const message = new TransactionMessage({
    payerKey: payer.publicKey,
    recentBlockhash: "11111111111111111111111111111111",
    instructions,
  }).compileToV0Message();
  const transaction = new VersionedTransaction(message);
  transaction.sign([payer]);
  return transaction;
}

test("profiles bundle transactions with simulation and size diagnostics", async () => {
  const versionedTxs = [
    buildVersionedTransaction(1),
    buildVersionedTransaction(2),
  ];
  const signatures = ["sig-1", "sig-2"];

  const diagnostics = await profileVersionedTransactions({
    versionedTxs,
    signatures,
    simulateTransaction: async (transaction) => {
      const txIndex = versionedTxs.indexOf(transaction);
      return {
        value: {
          err: null,
          unitsConsumed: 100_000 + txIndex,
          logs: [`tx-${txIndex}`],
        },
      };
    },
  });

  assert.equal(diagnostics.length, 2);
  assert.equal(diagnostics[0]?.txIndex, 0);
  assert.equal(diagnostics[0]?.signature, "sig-1");
  assert.equal(diagnostics[0]?.instructionCount, 1);
  assert.equal(diagnostics[0]?.signerCount, 1);
  assert.equal(diagnostics[0]?.unitsConsumed, 100_000);
  assert.equal(diagnostics[0]?.simulationError, null);
  assert.equal(diagnostics[0]?.simulationLogs?.[0], "tx-0");
  assert.equal(diagnostics[1]?.instructionCount, 2);
  assert.equal(diagnostics[1]?.unitsConsumed, 100_001);
  assert.ok((diagnostics[0]?.serializedSizeBytes ?? 0) > 0);
  assert.ok((diagnostics[1]?.serializedSizeBytes ?? 0) >= (diagnostics[0]?.serializedSizeBytes ?? 0));
});

test("captures per-transaction simulation failures without throwing", async () => {
  const versionedTxs = [buildVersionedTransaction(1)];

  const diagnostics = await profileVersionedTransactions({
    versionedTxs,
    signatures: ["sig-1"],
    simulateTransaction: async () => {
      return {
        value: {
          err: {
            InstructionError: [0, "Custom"],
          },
          unitsConsumed: 77_777,
          logs: ["program failed"],
        },
      };
    },
  });

  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0]?.signature, "sig-1");
  assert.equal(diagnostics[0]?.unitsConsumed, 77_777);
  assert.equal(
    diagnostics[0]?.simulationError,
    JSON.stringify({
      InstructionError: [0, "Custom"],
    })
  );
  assert.equal(diagnostics[0]?.simulationLogs?.[0], "program failed");
});
