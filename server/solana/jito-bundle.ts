import { bundle } from "jito-ts";
import {
  Keypair,
  SystemProgram,
  Transaction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import bs58 from "bs58";
import { getSolanaConnection } from "@/lib/solana/connection";
import { getTipAccount, sendBundle } from "@/server/solana/jito-client";

const MAX_TRANSACTIONS_PER_BUNDLE = 5;

export async function sendJitoBundle(
  txs: Transaction[],
  signers: Keypair[][],
  tipper: Keypair,
  tipLamports: number
) {
  const tipAccount = await getTipAccount();
  const lastIdx = txs.length - 1;

  if (tipLamports > 0 && txs[lastIdx]) {
    txs[lastIdx].add(
      SystemProgram.transfer({
        fromPubkey: tipper.publicKey,
        toPubkey: tipAccount,
        lamports: tipLamports,
      })
    );
  }

  const { blockhash } = await getSolanaConnection().getLatestBlockhash(
    "confirmed"
  );

  const versionedTxs: VersionedTransaction[] = [];
  const signatures: string[] = [];

  for (let i = 0; i < txs.length; i += 1) {
    const tx = txs[i];
    const txSigners = signers[i] ?? [];
    const allSigners =
      i === lastIdx && tipLamports > 0
        ? dedupeSigners([...txSigners, tipper])
        : txSigners;

    const messageV0 = new TransactionMessage({
      payerKey: tx.feePayer!,
      recentBlockhash: blockhash,
      instructions: tx.instructions,
    }).compileToV0Message();

    const vTx = new VersionedTransaction(messageV0);
    vTx.sign(allSigners);
    versionedTxs.push(vTx);
    signatures.push(bs58.encode(vTx.signatures[0]));
  }

  const b = new bundle.Bundle([], MAX_TRANSACTIONS_PER_BUNDLE);
  const withTxs = b.addTransactions(...versionedTxs);
  if (withTxs instanceof Error) {
    throw withTxs;
  }

  const result = await sendBundle(withTxs);
  if (!result.ok) {
    const message =
      typeof result.error === "string"
        ? result.error
        : result.error?.message || "Jito bundle send failed";
    throw new Error(message);
  }

  return { bundleId: result.value, signatures };
}

function dedupeSigners(signers: Keypair[]) {
  const seen = new Set<string>();
  return signers.filter((signer) => {
    const key = signer.publicKey.toBase58();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
