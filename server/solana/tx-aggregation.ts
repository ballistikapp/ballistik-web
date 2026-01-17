import {
  ComputeBudgetProgram,
  type Keypair,
  type PublicKey,
  Transaction,
  type TransactionInstruction,
} from "@solana/web3.js";
import { constructBuyTokenTransactionLocal } from "@/server/solana/pump-transactions";

const filterComputeBudget = (ixs: TransactionInstruction[]) =>
  ixs.filter((ix) => !ix.programId.equals(ComputeBudgetProgram.programId));

export async function constructTxsForBuysWithCreate(
  createTx: Transaction,
  createSigners: Keypair[],
  wallets: Keypair[],
  mint: PublicKey,
  buyAmountsLamport: bigint[],
  slippageBasisPoints: bigint,
  creator?: PublicKey
): Promise<[Transaction[], Keypair[][]]> {
  if (wallets.length === 0) {
    if (!createTx.feePayer) {
      createTx.feePayer = createSigners[0]?.publicKey;
    }
    return [[createTx], [createSigners]];
  }

  const outputTxs: Transaction[] = [];
  const signers: Keypair[][] = [];
  const buysInFirstTx = Math.min(1, wallets.length);
  const buysPerSubsequentTx = 3;

  const firstWallets = wallets.slice(0, buysInFirstTx);
  const firstAmounts = buyAmountsLamport.slice(0, buysInFirstTx);
  const firstBuyTxResults = await Promise.allSettled(
    firstWallets.map((wallet, i) =>
      constructBuyTokenTransactionLocal(
        wallet,
        mint,
        firstAmounts[i],
        creator
      )
    )
  );

  const firstTx = new Transaction();
  firstTx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 800_000 }));
  firstTx.add(...filterComputeBudget(createTx.instructions));

  for (const result of firstBuyTxResults) {
    if (result.status === "fulfilled") {
      firstTx.add(...filterComputeBudget(result.value.instructions));
    }
  }

  firstTx.feePayer = firstWallets[0].publicKey;
  outputTxs.push(firstTx);
  signers.push([...createSigners, ...firstWallets]);

  for (let i = buysInFirstTx; i < wallets.length; i += buysPerSubsequentTx) {
    const walletsSlice = wallets.slice(i, i + buysPerSubsequentTx);
    const buyAmountsSlice = buyAmountsLamport.slice(i, i + buysPerSubsequentTx);
    const tx = await constructSingleTxForBuys(
      walletsSlice,
      mint,
      buyAmountsSlice,
      slippageBasisPoints,
      creator
    );
    outputTxs.push(tx);
    signers.push(walletsSlice);
  }

  return [outputTxs, signers];
}

async function constructSingleTxForBuys(
  wallets: Keypair[],
  mint: PublicKey,
  buyAmountsLamport: bigint[],
  slippageBasisPoints: bigint,
  creator?: PublicKey
): Promise<Transaction> {
  const buyTxResults = await Promise.allSettled(
    wallets.map((wallet, i) =>
      constructBuyTokenTransactionLocal(
        wallet,
        mint,
        buyAmountsLamport[i],
        creator
      )
    )
  );

  const outputTx = new Transaction();
  for (const result of buyTxResults) {
    if (result.status === "fulfilled") {
      outputTx.add(...result.value.instructions);
    }
  }

  outputTx.feePayer = wallets[0].publicKey;
  return outputTx;
}
