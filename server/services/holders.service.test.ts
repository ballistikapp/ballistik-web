import assert from "node:assert/strict";
import test from "node:test";
import { PublicKey } from "@solana/web3.js";
import {
  aggregateCurrentHoldersFromTokenAccountData,
  aggregateCurrentHoldersFromTransactionRows,
} from "./holders.service";

function buildOwnerAmountSlice(owner: PublicKey, rawAmount: bigint) {
  const data = Buffer.alloc(40);
  owner.toBuffer().copy(data, 0);
  data.writeBigUInt64LE(rawAmount, 32);
  return data;
}

test("aggregateCurrentHoldersFromTokenAccountData merges balances by owner", () => {
  const ownerA = new PublicKey(new Uint8Array(32).fill(1));
  const ownerB = new PublicKey(new Uint8Array(32).fill(2));

  const holders = aggregateCurrentHoldersFromTokenAccountData([
    buildOwnerAmountSlice(ownerA, BigInt(1_000_000)),
    buildOwnerAmountSlice(ownerB, BigInt(1_250_000)),
    buildOwnerAmountSlice(ownerA, BigInt(2_750_000)),
    buildOwnerAmountSlice(ownerB, BigInt(0)),
    Buffer.alloc(12),
    null,
  ]);

  assert.deepEqual(holders, [
    {
      ownerWallet: ownerA.toBase58(),
      tokenBalance: 3.75,
    },
    {
      ownerWallet: ownerB.toBase58(),
      tokenBalance: 1.25,
    },
  ]);
});

test("aggregateCurrentHoldersFromTokenAccountData accepts Uint8Array account data", () => {
  const owner = new PublicKey(new Uint8Array(32).fill(3));

  const holders = aggregateCurrentHoldersFromTokenAccountData([
    new Uint8Array(buildOwnerAmountSlice(owner, BigInt(690_000))),
  ]);

  assert.deepEqual(holders, [
    {
      ownerWallet: owner.toBase58(),
      tokenBalance: 0.69,
    },
  ]);
});

test("aggregateCurrentHoldersFromTransactionRows computes net positive holders", () => {
  const holders = aggregateCurrentHoldersFromTransactionRows([
    {
      walletPublicKey: "wallet-a",
      transactionType: "BUY",
      tokenAmount: 3.43,
    },
    {
      walletPublicKey: "wallet-a",
      transactionType: "BUY",
      tokenAmount: 3.45,
    },
    {
      walletPublicKey: "wallet-b",
      transactionType: "BUY",
      tokenAmount: 4,
    },
    {
      walletPublicKey: "wallet-b",
      transactionType: "SELL",
      tokenAmount: 4,
    },
  ]);

  assert.deepEqual(holders, [
    {
      ownerWallet: "wallet-a",
      tokenBalance: 6.88,
    },
  ]);
});
