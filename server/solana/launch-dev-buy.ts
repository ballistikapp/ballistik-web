import type { Keypair, PublicKey, Transaction } from "@solana/web3.js";
import { buildBuyTokenTransaction } from "@/server/solana/pump-transaction-builders";

type BuildBuyTransaction = typeof buildBuyTokenTransaction;

type AppendLaunchDevBuyInstructionsParams = {
  createTx: Transaction;
  buyer: Keypair;
  mint: PublicKey;
  solAmountLamports: bigint;
  creator: PublicKey;
  minTokensOut?: bigint;
  buildBuyTransaction?: BuildBuyTransaction;
};

export async function appendLaunchDevBuyInstructions({
  createTx,
  buyer,
  mint,
  solAmountLamports,
  creator,
  minTokensOut = 1n,
  buildBuyTransaction = buildBuyTokenTransaction,
}: AppendLaunchDevBuyInstructionsParams) {
  if (solAmountLamports <= 0n) {
    return createTx;
  }

  const buyTx = await buildBuyTransaction(
    buyer,
    mint,
    solAmountLamports,
    creator,
    minTokensOut
  );

  createTx.add(...buyTx.instructions);

  return createTx;
}
