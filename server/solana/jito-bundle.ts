import { bundle } from "jito-ts";
import {
  Connection,
  Keypair,
  SystemProgram,
  Transaction,
  TransactionMessage,
  VersionedTransaction,
  type SignatureStatus,
} from "@solana/web3.js";
import bs58 from "bs58";
import { getSolanaConnection } from "@/lib/solana/connection";
import { logger } from "@/lib/logger";
import { getTipAccount, sendBundle } from "@/server/solana/jito-client";
import { waitForSignaturesViaGrpc } from "@/server/solana/shyft-grpc";

const MAX_TRANSACTIONS_PER_BUNDLE = 5;
const MAX_BUNDLE_SEND_ATTEMPTS = 3;
const BUNDLE_RETRY_BASE_DELAY_MS = 500;
const BUNDLE_RETRY_MAX_DELAY_MS = 2_000;
const BUNDLE_CONFIRM_TIMEOUT_MS = 120_000;
const BUNDLE_CONFIRM_INTERVAL_MS = 500;
const BUNDLE_CONFIRM_INTERVAL_BACKOFF_MS = 2000;
const BUNDLE_CONFIRM_GRPC_POLL_MS = 100;
const BUNDLE_CONFIRM_RPC_SLOW_POLL_MS = 3000;
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
  const connection = getSolanaConnection();
  logger.info("Jito bundle send start", {
    txCount: txs.length,
    signerGroupCount: signers.length,
    tipLamports,
    tipper: tipper.publicKey.toBase58(),
    rpcEndpoint: connection.rpcEndpoint,
  });
  const tipAccount = await getTipAccount();
  logger.info("Jito tip account resolved", {
    tipAccount: tipAccount.toBase58(),
  });
  const bundleTxs = txs.map((tx) => {
    const clone = new Transaction();
    clone.add(...tx.instructions);
    clone.feePayer = tx.feePayer;
    return clone;
  });
  const feePayers = Array.from(
    new Set(
      bundleTxs
        .map((tx) => tx.feePayer?.toBase58())
        .filter((value): value is string => Boolean(value))
    )
  );
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

  const blockhashFetchedAt = Date.now();
  const { blockhash } = await connection.getLatestBlockhash("confirmed");
  logger.info("Bundle blockhash fetched", { blockhash });
  const { versionedTxs, signatures } = buildVersionedTransactions(
    bundleTxs,
    signers,
    tipper,
    tipLamports,
    blockhash
  );
  logger.info("Bundle versioned transactions built", {
    signatureCount: signatures.length,
    signaturesPreview: signatures.slice(0, 3),
    feePayers,
    blockhash,
  });
  if (versionedTxs[0]) {
    const simulation = await connection.simulateTransaction(versionedTxs[0], {
      sigVerify: false,
      commitment: "processed",
    });
    if (simulation.value.err) {
      logger.error("Bundle first transaction simulation failed", {
        error: simulation.value.err,
        logs: simulation.value.logs?.slice(0, 8),
      });

      const errStr = JSON.stringify(simulation.value.err);
      const isCriticalError =
        errStr.includes("InsufficientFundsForRent") ||
        errStr.includes("InsufficientFunds") ||
        errStr.includes("AccountNotFound") ||
        errStr.includes("InvalidAccountData") ||
        errStr.includes("ProgramFailedToComplete");

      if (isCriticalError) {
        throw new Error(`Transaction simulation failed: ${errStr}`);
      }
    } else {
      logger.info("Bundle first transaction simulation succeeded", {
        unitsConsumed: simulation.value.unitsConsumed ?? null,
      });
    }
  }
  const bundleContainer = new bundle.Bundle([], MAX_TRANSACTIONS_PER_BUNDLE);
  const withTxs = bundleContainer.addTransactions(...versionedTxs);
  if (withTxs instanceof Error) {
    throw withTxs;
  }

  let lastSendEndpoint: string | null = null;
  const sendBundleWithRetries = async () => {
    let lastError: Error | null = null;
    for (let attempt = 1; attempt <= MAX_BUNDLE_SEND_ATTEMPTS; attempt += 1) {
      try {
        const result = await sendBundle(withTxs);
        if (typeof result === "object" && result && "endpoint" in result) {
          lastSendEndpoint =
            typeof result.endpoint === "string" ? result.endpoint : null;
        }
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
  logger.info("Jito bundle sent", {
    bundleId: initialBundleId,
    signatureCount: signatures.length,
    endpoint: lastSendEndpoint,
  });
  const confirmedBundleId = await confirmBundleOnChain({
    connection,
    signatures,
    accountKeys: feePayers,
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
  accountKeys,
  blockhashFetchedAt,
  sendBundleWithRetries,
  bundleId,
}: {
  connection: ReturnType<typeof getSolanaConnection>;
  signatures: string[];
  accountKeys: string[];
  blockhashFetchedAt: number;
  sendBundleWithRetries: () => Promise<string>;
  bundleId: string;
}) {
  const startedAt = Date.now();
  let lastResendAt = 0;
  let currentBundleId = bundleId;
  let lastSummary: BundleStatusSummary | null = null;
  let lastStatusError: string | null = null;
  let lastLoggedSummary: string | null = null;
  let lastLoggedStatusError: string | null = null;
  const fallbackConnection = getFallbackConnection();
  logger.info("Bundle confirmation start", {
    bundleId,
    signatureCount: signatures.length,
    createSignature: signatures[0],
    rpcEndpoint: connection.rpcEndpoint,
    fallbackRpcEndpoint: fallbackConnection?.rpcEndpoint ?? null,
    accountKeyCount: accountKeys.length,
  });
  const grpcState: { done: boolean; result: Set<string> | null; active: boolean } = {
    done: false,
    result: null,
    active: false,
  };

  const grpcPromise = waitForSignaturesViaGrpc({
    signatures,
    accountKeys,
    timeoutMs: BUNDLE_CONFIRM_TIMEOUT_MS,
  });

  grpcPromise
    .then((result) => {
      grpcState.done = true;
      grpcState.result = result;
      if (result !== null) {
        grpcState.active = true;
      }
    })
    .catch(() => {
      grpcState.done = true;
      grpcState.result = null;
    });

  await sleep(50);
  grpcState.active = !grpcState.done || grpcState.result !== null;

  logger.info("Bundle confirmation mode", {
    grpcActive: grpcState.active,
    bundleId,
  });

  let currentInterval = grpcState.active
    ? BUNDLE_CONFIRM_RPC_SLOW_POLL_MS
    : BUNDLE_CONFIRM_INTERVAL_MS;
  let rateLimitCount = 0;
  let lastRpcCheckAt = 0;

  while (Date.now() - startedAt < BUNDLE_CONFIRM_TIMEOUT_MS) {
    if (grpcState.result?.has(signatures[0])) {
      logger.info("Bundle confirmed via gRPC", {
        bundleId: currentBundleId,
        signature: signatures[0],
        elapsedMs: Date.now() - startedAt,
      });
      return currentBundleId;
    }

    if (grpcState.done && grpcState.result === null && !grpcState.active) {
      currentInterval = BUNDLE_CONFIRM_INTERVAL_MS;
    }

    const shouldCheckRpc =
      !grpcState.active ||
      grpcState.done ||
      Date.now() - lastRpcCheckAt >= BUNDLE_CONFIRM_RPC_SLOW_POLL_MS;

    if (shouldCheckRpc) {
      lastRpcCheckAt = Date.now();
      try {
        const primaryStatuses = await fetchSignatureStatuses(
          connection,
          signatures
        );
        const fallbackStatuses = fallbackConnection
          ? await fetchSignatureStatuses(fallbackConnection, signatures)
          : null;
        const statuses = fallbackStatuses
          ? mergeSignatureStatuses(primaryStatuses, fallbackStatuses)
          : primaryStatuses;
        const summary = summarizeBundleStatuses(statuses);
        lastSummary = summary;
        lastStatusError = null;

        if (rateLimitCount > 0) {
          rateLimitCount = 0;
          currentInterval = grpcState.active
            ? BUNDLE_CONFIRM_RPC_SLOW_POLL_MS
            : BUNDLE_CONFIRM_INTERVAL_MS;
        }

        const summaryKey = `${summary.foundCount}:${summary.confirmedCount}:${summary.failedCount}:${summary.notFoundCount}:${summary.createStatus}`;
        if (summaryKey !== lastLoggedSummary) {
          logger.info("Bundle confirmation summary", {
            bundleId: currentBundleId,
            elapsedMs: Date.now() - startedAt,
            blockhashAgeMs: Date.now() - blockhashFetchedAt,
            grpcActive: grpcState.active,
            ...summary,
          });
          lastLoggedSummary = summaryKey;
        }
        if (summary.createError) {
          logger.warn("Bundle create failed", {
            bundleId: currentBundleId,
            createError: summary.createError,
            elapsedMs: Date.now() - startedAt,
          });
          throw new Error(
            `Create transaction failed: ${JSON.stringify(summary.createError)}`
          );
        }
        if (summary.createConfirmed) {
          return currentBundleId;
        }
        const blockhashAge = Date.now() - blockhashFetchedAt;
        if (
          summary.foundCount === 0 &&
          blockhashAge < BUNDLE_BLOCKHASH_MAX_AGE_MS &&
          Date.now() - lastResendAt > BUNDLE_RESEND_INTERVAL_MS
        ) {
          logger.warn("Bundle resend triggered", {
            bundleId: currentBundleId,
            elapsedMs: Date.now() - startedAt,
            blockhashAgeMs: blockhashAge,
          });
          const previousBundleId = currentBundleId;
          currentBundleId = await sendBundleWithRetries();
          logger.info("Bundle resent", {
            previousBundleId,
            bundleId: currentBundleId,
          });
          lastResendAt = Date.now();
        }
      } catch (error) {
        const primaryError =
          error instanceof Error ? error.message : String(error);
        let fallbackErrorText = "";
        if (fallbackConnection && lastStatusError) {
          fallbackErrorText = ` fallback=${lastStatusError}`;
        }
        lastStatusError = `${primaryError}${fallbackErrorText}`;
        if (lastStatusError !== lastLoggedStatusError) {
          logger.warn("Bundle status check error", {
            bundleId: currentBundleId,
            error: lastStatusError,
            elapsedMs: Date.now() - startedAt,
          });
          lastLoggedStatusError = lastStatusError;
        }

        if (isRateLimitMessage(primaryError)) {
          rateLimitCount += 1;
          currentInterval = Math.min(
            BUNDLE_CONFIRM_INTERVAL_BACKOFF_MS * rateLimitCount,
            BUNDLE_CONFIRM_TIMEOUT_MS / 10
          );
          logger.info("Rate limit detected, backing off", {
            rateLimitCount,
            nextIntervalMs: currentInterval,
          });
        }
      }
    }

    const pollInterval = grpcState.active
      ? BUNDLE_CONFIRM_GRPC_POLL_MS
      : currentInterval;
    await sleep(pollInterval);
  }

  const summaryText = lastSummary
    ? `found=${lastSummary.foundCount} confirmed=${lastSummary.confirmedCount} failed=${lastSummary.failedCount} notFound=${lastSummary.notFoundCount} createStatus=${lastSummary.createStatus}`
    : "no status summary";
  const statusErrorText = lastStatusError ? ` statusError=${lastStatusError}` : "";
  throw new Error(
    `Bundle sent but CREATE transaction not confirmed on-chain (${summaryText}${statusErrorText})`
  );
}

type BundleStatusSummary = {
  foundCount: number;
  confirmedCount: number;
  failedCount: number;
  notFoundCount: number;
  createConfirmed: boolean;
  createError: SignatureStatus["err"] | null;
  createStatus: string;
};

function summarizeBundleStatuses(
  statuses: (SignatureStatus | null)[]
): BundleStatusSummary {
  let foundCount = 0;
  let confirmedCount = 0;
  let failedCount = 0;
  let notFoundCount = 0;
  const createStatus = statuses[0] ?? null;

  for (const status of statuses) {
    if (!status) {
      notFoundCount += 1;
      continue;
    }
    foundCount += 1;
    if (status.err) {
      failedCount += 1;
      continue;
    }
    if (
      status.confirmationStatus === "confirmed" ||
      status.confirmationStatus === "finalized"
    ) {
      confirmedCount += 1;
    }
  }

  const createConfirmed = Boolean(
    createStatus &&
      !createStatus.err &&
      (createStatus.confirmationStatus === "confirmed" ||
        createStatus.confirmationStatus === "finalized")
  );
  const createError = createStatus?.err ?? null;
  const createStatusLabel = createStatus
    ? createStatus.err
      ? "failed"
      : createStatus.confirmationStatus || "found"
    : "not_found";

  return {
    foundCount,
    confirmedCount,
    failedCount,
    notFoundCount,
    createConfirmed,
    createError,
    createStatus: createStatusLabel,
  };
}

function getFallbackConnection() {
  const fallbackUrl = process.env.SOLANA_RPC_FALLBACK_URL;
  if (!fallbackUrl) {
    return null;
  }
  return new Connection(fallbackUrl, "confirmed");
}

async function fetchSignatureStatuses(
  connection: Connection,
  signatures: string[]
) {
  const response = await connection.getSignatureStatuses(signatures, {
    searchTransactionHistory: true,
  });
  return response.value;
}

function mergeSignatureStatuses(
  primary: (SignatureStatus | null)[],
  fallback: (SignatureStatus | null)[]
) {
  return primary.map((status, index) =>
    pickBestStatus(status, fallback[index] ?? null)
  );
}

function pickBestStatus(
  primary: SignatureStatus | null,
  fallback: SignatureStatus | null
) {
  if (!primary) return fallback;
  if (!fallback) return primary;
  if (primary.err) return primary;
  if (fallback.err) return fallback;
  return statusRank(fallback) > statusRank(primary) ? fallback : primary;
}

function statusRank(status: SignatureStatus | null) {
  if (!status || status.err) return -1;
  if (status.confirmationStatus === "finalized") return 2;
  if (status.confirmationStatus === "confirmed") return 1;
  return 0;
}
