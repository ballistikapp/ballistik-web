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
const MAX_BUNDLE_SEND_ATTEMPTS = 3;
const BUNDLE_RETRY_BASE_DELAY_MS = 500;
const BUNDLE_RETRY_MAX_DELAY_MS = 2_000;
const BUNDLE_CONFIRM_TIMEOUT_MS = 120_000;
const BUNDLE_CONFIRM_INTERVAL_MS = 400;
const BUNDLE_RESEND_INTERVAL_MS = 5_000;
const BUNDLE_BLOCKHASH_MAX_AGE_MS = 55_000;

export async function sendJitoBundle(
  txs: Transaction[],
  signers: Keypair[][],
  tipper: Keypair,
  tipLamports: number
) {
  if (txs.length === 0) {
    throw new Error("No transactions provided for bundle");
  }
  if (txs.length > MAX_TRANSACTIONS_PER_BUNDLE) {
    throw new Error(
      `Bundle exceeds max transactions: ${txs.length} > ${MAX_TRANSACTIONS_PER_BUNDLE}`
    );
  }
  if (signers.length !== txs.length) {
    throw new Error(
      `Bundle signer mismatch: ${signers.length} signer groups for ${txs.length} transactions`
    );
  }
  const tipAccount = await getTipAccount();
  const bundleTxs = txs.map((tx) => {
    const clone = new Transaction();
    clone.add(...tx.instructions);
    clone.feePayer = tx.feePayer;
    return clone;
  });
  const lastIdx = bundleTxs.length - 1;

  if (tipLamports > 0 && bundleTxs[lastIdx]) {
    bundleTxs[lastIdx].add(
      SystemProgram.transfer({
        fromPubkey: tipper.publicKey,
        toPubkey: tipAccount,
        lamports: tipLamports,
      })
    );
  }

  const connection = getSolanaConnection();
  const blockhashFetchedAt = Date.now();
  const { blockhash } = await connection.getLatestBlockhash("confirmed");
  const { versionedTxs, signatures } = buildVersionedTransactions(
    bundleTxs,
    signers,
    tipper,
    tipLamports,
    blockhash
  );
  const bundleContainer = new bundle.Bundle([], MAX_TRANSACTIONS_PER_BUNDLE);
  const withTxs = bundleContainer.addTransactions(...versionedTxs);
  if (withTxs instanceof Error) {
    throw withTxs;
  }

  const sendBundleWithRetries = async () => {
    let lastError: Error | null = null;
    for (let attempt = 1; attempt <= MAX_BUNDLE_SEND_ATTEMPTS; attempt += 1) {
      try {
        const result = await sendBundle(withTxs);
        if (!result.ok) {
          const message =
            typeof result.error === "string"
              ? result.error
              : result.error?.message || "Jito bundle send failed";
          throw new Error(message);
        }
        return result.value;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (
          !isRateLimitMessage(message) ||
          attempt === MAX_BUNDLE_SEND_ATTEMPTS
        ) {
          throw error instanceof Error ? error : new Error(message);
        }
        lastError = error instanceof Error ? error : new Error(message);
        const delayMs = Math.min(
          BUNDLE_RETRY_BASE_DELAY_MS * 2 ** (attempt - 1),
          BUNDLE_RETRY_MAX_DELAY_MS
        );
        const jitterMs = Math.floor(Math.random() * 100);
        await sleep(delayMs + jitterMs);
      }
    }
    if (lastError) {
      throw lastError;
    }
    throw new Error("Jito bundle send failed");
  };

  const initialBundleId = await sendBundleWithRetries();
  const confirmedBundleId = await confirmBundleOnChain({
    connection,
    signatures,
    blockhashFetchedAt,
    sendBundleWithRetries,
    bundleId: initialBundleId,
  });
  return { bundleId: confirmedBundleId, signatures };
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

function buildVersionedTransactions(
  txs: Transaction[],
  signers: Keypair[][],
  tipper: Keypair,
  tipLamports: number,
  blockhash: string
) {
  const versionedTxs: VersionedTransaction[] = [];
  const signatures: string[] = [];
  const lastIdx = txs.length - 1;

  for (let i = 0; i < txs.length; i += 1) {
    const tx = txs[i];
    if (!tx.feePayer) {
      throw new Error(`Missing fee payer for bundle transaction ${i}`);
    }
    const txSigners = signers[i] ?? [];
    const allSigners =
      i === lastIdx && tipLamports > 0
        ? dedupeSigners([...txSigners, tipper])
        : txSigners;

    const messageV0 = new TransactionMessage({
      payerKey: tx.feePayer,
      recentBlockhash: blockhash,
      instructions: tx.instructions,
    }).compileToV0Message();

    const vTx = new VersionedTransaction(messageV0);
    vTx.sign(allSigners);
    versionedTxs.push(vTx);
    signatures.push(bs58.encode(vTx.signatures[0]));
  }

  return { versionedTxs, signatures };
}

function isRateLimitMessage(message: string) {
  const normalized = message.toLowerCase();
  return (
    normalized.includes("too many requests") ||
    normalized.includes("rate limit") ||
    normalized.includes("429") ||
    normalized.includes("resource has been exhausted") ||
    normalized.includes("network congested")
  );
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function confirmBundleOnChain({
  connection,
  signatures,
  blockhashFetchedAt,
  sendBundleWithRetries,
  bundleId,
}: {
  connection: ReturnType<typeof getSolanaConnection>;
  signatures: string[];
  blockhashFetchedAt: number;
  sendBundleWithRetries: () => Promise<string>;
  bundleId: string;
}) {
  const startedAt = Date.now();
  let lastResendAt = 0;
  let currentBundleId = bundleId;

  while (Date.now() - startedAt < BUNDLE_CONFIRM_TIMEOUT_MS) {
    const response = await connection.getSignatureStatuses(signatures, {
      searchTransactionHistory: true,
    });
    const statuses = response.value;
    const createStatus = statuses[0];
    if (createStatus?.err) {
      throw new Error(
        `Create transaction failed: ${JSON.stringify(createStatus.err)}`
      );
    }
    if (
      createStatus?.confirmationStatus === "confirmed" ||
      createStatus?.confirmationStatus === "finalized"
    ) {
      return currentBundleId;
    }
    const foundCount = statuses.filter(Boolean).length;
    const blockhashAge = Date.now() - blockhashFetchedAt;
    if (
      foundCount === 0 &&
      blockhashAge < BUNDLE_BLOCKHASH_MAX_AGE_MS &&
      Date.now() - lastResendAt > BUNDLE_RESEND_INTERVAL_MS
    ) {
      currentBundleId = await sendBundleWithRetries();
      lastResendAt = Date.now();
    }
    await sleep(BUNDLE_CONFIRM_INTERVAL_MS);
  }

  throw new Error("Bundle sent but CREATE transaction not confirmed on-chain");
}
