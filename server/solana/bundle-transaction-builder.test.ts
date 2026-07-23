import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import {
  ComputeBudgetProgram,
  Keypair,
  Transaction,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";

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

async function loadBundleTransactionBuilder() {
  stubServerOnlyModule();
  return import("./bundle-transaction-builder");
}

const BUY_PROGRAM_ID = Keypair.generate().publicKey;

function buildCreateTransaction(creator: Keypair, mint: Keypair) {
  const tx = new Transaction();
  tx.add(
    new TransactionInstruction({
      programId: Keypair.generate().publicKey,
      keys: [
        { pubkey: creator.publicKey, isSigner: true, isWritable: true },
        { pubkey: mint.publicKey, isSigner: true, isWritable: true },
      ],
      data: Buffer.from([1]),
    })
  );
  return tx;
}

function buildBuyTransaction({
  includeAtaCreate,
  buyer,
  mint,
  useRealAtaCreate = false,
}: {
  includeAtaCreate: boolean;
  buyer: Keypair;
  mint: Keypair;
  useRealAtaCreate?: boolean;
}) {
  const tx = new Transaction();
  if (includeAtaCreate) {
    if (useRealAtaCreate) {
      const associatedToken = getAssociatedTokenAddressSync(
        mint.publicKey,
        buyer.publicKey,
        false,
        TOKEN_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID
      );
      tx.add(
        createAssociatedTokenAccountInstruction(
          buyer.publicKey,
          associatedToken,
          buyer.publicKey,
          mint.publicKey,
          TOKEN_PROGRAM_ID,
          ASSOCIATED_TOKEN_PROGRAM_ID
        )
      );
    } else {
      tx.add(
        new TransactionInstruction({
          programId: ASSOCIATED_TOKEN_PROGRAM_ID,
          keys: [
            { pubkey: buyer.publicKey, isSigner: true, isWritable: true },
            { pubkey: Keypair.generate().publicKey, isSigner: false, isWritable: true },
            { pubkey: buyer.publicKey, isSigner: false, isWritable: false },
            { pubkey: mint.publicKey, isSigner: false, isWritable: false },
          ],
          data: Buffer.alloc(0),
        })
      );
    }
  }
  tx.add(
    ComputeBudgetProgram.setComputeUnitLimit({ units: 10 }),
    new TransactionInstruction({
      programId: BUY_PROGRAM_ID,
      keys: [{ pubkey: buyer.publicKey, isSigner: true, isWritable: true }],
      data: Buffer.from([2]),
    })
  );
  tx.feePayer = buyer.publicKey;
  return tx;
}

test("hoists follow-up ATA creation into the first bundle transaction", async () => {
  const { buildBundleTransactionsForCreateAndBuys } =
    await loadBundleTransactionBuilder();
  const creator = Keypair.generate();
  const mint = Keypair.generate();
  const secondBuyer = Keypair.generate();
  const createTx = buildCreateTransaction(creator, mint);

  const [transactions, signers] = await buildBundleTransactionsForCreateAndBuys(
    createTx,
    [creator, mint],
    [creator, secondBuyer],
    mint.publicKey,
    [BigInt(10), BigInt(20)],
    creator.publicKey,
    {
      buildBuyTransaction: async (buyer) =>
        buildBuyTransaction({
          includeAtaCreate: buyer.publicKey.equals(secondBuyer.publicKey),
          buyer,
          mint,
        }),
    }
  );

  assert.equal(transactions.length, 2);
  const hoistedAtaInstruction = transactions[0]?.instructions.find((ix) =>
    ix.programId.equals(ASSOCIATED_TOKEN_PROGRAM_ID)
  );
  assert.ok(hoistedAtaInstruction);
  assert.equal(
    transactions[0]?.instructions.some((ix) =>
      ix.programId.equals(ComputeBudgetProgram.programId)
    ),
    false
  );
  assert.equal(
    hoistedAtaInstruction?.keys[0]?.pubkey.toBase58(),
    secondBuyer.publicKey.toBase58()
  );
  assert.equal(hoistedAtaInstruction?.keys[0]?.isSigner, true);
  assert.equal(
    hoistedAtaInstruction?.keys[2]?.pubkey.toBase58(),
    secondBuyer.publicKey.toBase58()
  );
  assert.equal(
    transactions[1]?.instructions.some((ix) =>
      ix.programId.equals(ComputeBudgetProgram.programId)
    ),
    true
  );
  assert.equal(
    transactions[1]?.instructions.some((ix) =>
      ix.programId.equals(ASSOCIATED_TOKEN_PROGRAM_ID)
    ),
    false
  );
  assert.equal(
    transactions[1]?.instructions.some((ix) => ix.programId.equals(BUY_PROGRAM_ID)),
    true
  );
  assert.equal(
    signers[0]?.some((signer) => signer.publicKey.equals(secondBuyer.publicKey)),
    true
  );

  const firstMessage = new TransactionMessage({
    payerKey: transactions[0]!.feePayer!,
    recentBlockhash: "11111111111111111111111111111111",
    instructions: transactions[0]!.instructions,
  }).compileToV0Message();
  assert.equal(firstMessage.header.numRequiredSignatures, 3);
});

test("caps ATA hoisting so high-buyer bundles still serialize", async () => {
  const {
    MAX_RAW_TRANSACTION_BYTES,
    buildBundleTransactionsForCreateAndBuys,
  } = await loadBundleTransactionBuilder();
  const creator = Keypair.generate();
  const mint = Keypair.generate();
  const bundlers = Array.from({ length: 10 }, () => Keypair.generate());
  const createTx = buildCreateTransaction(creator, mint);

  const [transactions, signers] = await buildBundleTransactionsForCreateAndBuys(
    createTx,
    [creator, mint],
    [creator, ...bundlers],
    mint.publicKey,
    [BigInt(10), ...bundlers.map(() => BigInt(20))],
    creator.publicKey,
    {
      buildBuyTransaction: async (buyer) =>
        buildBuyTransaction({
          includeAtaCreate: !buyer.publicKey.equals(creator.publicKey),
          buyer,
          mint,
          useRealAtaCreate: true,
        }),
    }
  );

  // 11 buyers → create+first buy, then 5 follow-up txs × 2 buys (no ALT).
  assert.equal(transactions.length, 6);

  const firstTxAtaCount =
    transactions[0]?.instructions.filter((ix) =>
      ix.programId.equals(ASSOCIATED_TOKEN_PROGRAM_ID)
    ).length ?? 0;
  assert.ok(firstTxAtaCount < bundlers.length);

  for (const [index, transaction] of transactions.entries()) {
    const message = new TransactionMessage({
      payerKey: transaction!.feePayer!,
      recentBlockhash: "11111111111111111111111111111111",
      instructions: transaction!.instructions,
    }).compileToV0Message();
    const versionedTx = new VersionedTransaction(message);
    const requiredSignerKeys = new Set(
      message.staticAccountKeys
        .slice(0, message.header.numRequiredSignatures)
        .map((key) => key.toBase58())
    );
    versionedTx.sign(
      (signers[index] ?? []).filter((signer) =>
        requiredSignerKeys.has(signer.publicKey.toBase58())
      )
    );
    assert.ok(versionedTx.serialize().length <= MAX_RAW_TRANSACTION_BYTES);
  }
});

test("bundle packing helpers share one source of truth for buyer→tx mapping", async () => {
  const {
    BUNDLE_BUYS_PER_FOLLOW_UP_TX_WITH_ALT,
    BUNDLE_BUYS_PER_FOLLOW_UP_TX_WITHOUT_ALT,
    MAX_RAW_TRANSACTION_BYTES,
    bundleBuyerTransactionIndex,
    bundleBuysPerFollowUpTransaction,
  } = await loadBundleTransactionBuilder();

  assert.equal(
    bundleBuysPerFollowUpTransaction(false),
    BUNDLE_BUYS_PER_FOLLOW_UP_TX_WITHOUT_ALT
  );
  assert.equal(
    bundleBuysPerFollowUpTransaction(true),
    BUNDLE_BUYS_PER_FOLLOW_UP_TX_WITH_ALT
  );
  assert.equal(BUNDLE_BUYS_PER_FOLLOW_UP_TX_WITHOUT_ALT, 2);
  assert.equal(BUNDLE_BUYS_PER_FOLLOW_UP_TX_WITH_ALT, 4);
  assert.equal(MAX_RAW_TRANSACTION_BYTES, 1232);

  const withoutAlt = bundleBuysPerFollowUpTransaction(false);
  assert.equal(bundleBuyerTransactionIndex(0, withoutAlt), 0);
  assert.equal(bundleBuyerTransactionIndex(1, withoutAlt), 1);
  assert.equal(bundleBuyerTransactionIndex(2, withoutAlt), 1);
  assert.equal(bundleBuyerTransactionIndex(3, withoutAlt), 2);

  const withAlt = bundleBuysPerFollowUpTransaction(true);
  assert.equal(bundleBuyerTransactionIndex(0, withAlt), 0);
  assert.equal(bundleBuyerTransactionIndex(1, withAlt), 1);
  assert.equal(bundleBuyerTransactionIndex(4, withAlt), 1);
  assert.equal(bundleBuyerTransactionIndex(5, withAlt), 2);
});
