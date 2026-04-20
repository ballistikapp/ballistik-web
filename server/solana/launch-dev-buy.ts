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
  /** Must match `createV2` mayhem flag when the curve is not on-chain yet. */
  isMayhemMode?: boolean;
  buildBuyTransaction?: BuildBuyTransaction;
};

export async function appendLaunchDevBuyInstructions({
  createTx,
  buyer,
  mint,
  solAmountLamports,
  creator,
  minTokensOut = BigInt(1),
  isMayhemMode,
  buildBuyTransaction = buildBuyTokenTransaction,
}: AppendLaunchDevBuyInstructionsParams) {
  if (solAmountLamports <= BigInt(0)) {
    return createTx;
  }

  const buyTx = await buildBuyTransaction(
    buyer,
    mint,
    solAmountLamports,
    creator,
    minTokensOut,
    { isMayhemMode }
  );

  createTx.add(...buyTx.instructions);

  return createTx;
}
