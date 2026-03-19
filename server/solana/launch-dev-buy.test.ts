import assert from "node:assert/strict";
import test from "node:test";
import { Keypair, Transaction, TransactionInstruction } from "@solana/web3.js";
import { appendLaunchDevBuyInstructions } from "@/server/solana/launch-dev-buy";

test("appends create-time dev buy instructions with creator fallback", async () => {
  const buyer = Keypair.generate();
  const mint = Keypair.generate().publicKey;
  const createTx = new Transaction();
  const appendedInstruction = new TransactionInstruction({
    programId: Keypair.generate().publicKey,
    keys: [],
    data: Buffer.alloc(0),
  });

  let captured:
    | {
        buyer: Keypair;
        mint: string;
        solAmountLamports: bigint;
        creator: string | undefined;
        minTokensOut: bigint | undefined;
      }
    | undefined;

  await appendLaunchDevBuyInstructions({
    createTx,
    buyer,
    mint,
    solAmountLamports: BigInt(100_000_000),
    creator: buyer.publicKey,
    buildBuyTransaction: async (
      capturedBuyer,
      capturedMint,
      capturedSolAmountLamports,
      capturedCreator,
      capturedMinTokensOut
    ) => {
      captured = {
        buyer: capturedBuyer,
        mint: capturedMint.toBase58(),
        solAmountLamports: capturedSolAmountLamports,
        creator: capturedCreator?.toBase58(),
        minTokensOut: capturedMinTokensOut,
      };

      const buyTx = new Transaction();
      buyTx.add(appendedInstruction);
      return buyTx;
    },
  });

  assert.equal(createTx.instructions.length, 1);
  assert.equal(createTx.instructions[0], appendedInstruction);
  assert.equal(captured?.buyer, buyer);
  assert.equal(captured?.mint, mint.toBase58());
  assert.equal(captured?.solAmountLamports, BigInt(100_000_000));
  assert.equal(captured?.creator, buyer.publicKey.toBase58());
  assert.equal(captured?.minTokensOut, BigInt(1));
});
