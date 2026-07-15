import { bundle } from "jito-ts";
import {
  Connection,
  Keypair,
  SystemProgram,
  Transaction,
  TransactionMessage,
  VersionedTransaction,
  type AddressLookupTableAccount,
  type SignatureStatus,
} from "@solana/web3.js";
import bs58 from "bs58";
import { getSolanaConnection } from "@/lib/solana/connection";
import { logger } from "@/lib/logger";
import {
  getBundleStatuses,
  getInflightBundleStatuses,
  getTipAccount,
  rotatePreferredEndpointAwayFrom,
  sendBundle,
  type JitoInflightBundleStatus,
} from "@/server/solana/jito-client";
import { waitForSignaturesViaGrpc } from "@/server/solana/shyft-grpc";
import { mapPumpError } from "@/server/solana/pump/errors";
import { simulateBundleSequentially } from "@/server/solana/simulate-bundle";

const MAX_TRANSACTIONS_PER_BUNDLE = 5;
const MAX_BUNDLE_SEND_ATTEMPTS = 3;
const BUNDLE_RETRY_BASE_DELAY_MS = 500;
const BUNDLE_RETRY_MAX_DELAY_MS = 2_000;
const BUNDLE_CONFIRM_TIMEOUT_MS = 180_000;
const BUNDLE_CONFIRM_INTERVAL_MS = 500;
const BUNDLE_CONFIRM_INTERVAL_BACKOFF_MS = 2000;
const BUNDLE_CONFIRM_GRPC_POLL_MS = 100;
const BUNDLE_CONFIRM_RPC_SLOW_POLL_MS = 3000;
// getBundleStatuses (cross-region landing check) is polled less frequently
// than the per-region inflight check to stay within Jito's 1-req/sec
// per-endpoint budget. The endpoint cooldown system in jito-client handles
// the rest.
const BUNDLE_STATUS_CHECK_INTERVAL_MS = 3_000;
const BUNDLE_RESEND_INTERVAL_MS = 5_000;
const BUNDLE_BLOCKHASH_MAX_AGE_MS = 55_000;
const MAX_BLOCKHASH_REBUILDS = 2;

// getBundleStatuses returns `err` as a Rust `Result<(), TransactionError>`:
// `{ Ok: null }` on success, `{ Err: {...} }` on failure. It is never a bare
// `null`/`undefined` for a landed bundle, but callers can pass those through
// too, so treat anything that isn't an explicit `Err` as success.
//
// `{ Err: { Retryable: "..." } }` is a Jito status-API infrastructure failure
// (e.g. "Failed to retrieve information from solana cluster"), not a landed
// transaction InstructionError. Do not treat it as on-chain failure — keep
// polling until confirmationStatus/RPC/gRPC resolve the outcome.
function isJitoBundleStatusRetryable(err: unknown): boolean {
  if (err === null || err === undefined || typeof err !== "object") {
    return false;
  }
  const record = err as Record<string, unknown>;
  if (!("Err" in record)) return false;
  const inner = record.Err;
  return (
    inner !== null &&
    typeof inner === "object" &&
    "Retryable" in (inner as Record<string, unknown>)
  );
}

function isJitoBundleStatusError(err: unknown): boolean {
  if (err === null || err === undefined) return false;
  if (typeof err === "object" && "Ok" in (err as Record<string, unknown>)) {
    return false;
  }
  if (isJitoBundleStatusRetryable(err)) return false;
  return true;
}

export type BundleTelemetryEvent = {
  type:
    | "bundle_send_start"
    | "bundle_transactions_profiled"
    | "bundle_sequential_simulation"
    | "bundle_dropped_by_engine"
    | "bundle_send_rejections"
    | "bundle_sent"
    | "bundle_confirm_start"
    | "bundle_confirm_summary"
    | "bundle_inflight_status"
    | "bundle_status_check"
    | "bundle_resend_triggered"
    | "bundle_resent"
    | "bundle_rebuild_triggered"
    | "bundle_rebuilt"
    | "bundle_status_check_error"
    | "bundle_tip_escalated"
    | "bundle_confirm_timeout";
  data: Record<string, unknown>;
};

type BundleTelemetryHandler = (
  event: BundleTelemetryEvent
) => void | Promise<void>;

type AdaptiveTipEscalationOptions = {
  enabled?: boolean;
  multiplier?: number;
  maxEscalations?: number;
};

type SendJitoBundleOptions = {
  onEvent?: BundleTelemetryHandler;
  adaptiveTipEscalation?: AdaptiveTipEscalationOptions;
  enableGrpc?: boolean;
  launchId?: string;
  altAccounts?: AddressLookupTableAccount[];
};

type SimulateTransactionResult = {
  value: {
    err: unknown;
    unitsConsumed?: number | null;
    logs?: string[] | null;
  };
};

type SimulateTransactionFn = (
  transaction: VersionedTransaction
) => Promise<SimulateTransactionResult>;

export type BundleTransactionProfile = {
  txIndex: number;
  signature: string | null;
  instructionCount: number;
  signerCount: number;
  serializedSizeBytes: number;
  unitsConsumed: number | null;
  simulationError: string | null;
  simulationLogs: string[] | null;
};

type BundleInflightStatusSummary = JitoInflightBundleStatus & {
  endpoint: string;
  contextSlot: number | null;
  // Whether the reading came from the endpoint that accepted the send.
  // "Invalid" from any other region is inconclusive.
  matchedPreferred: boolean;
};

// Dropped-bundle detection: "Invalid" from the endpoint that accepted the
// send means the block engine is no longer tracking the bundle. Sustained
// Invalid readings shortly after a send indicate the engine dropped the
// bundle before the auction — resend immediately instead of waiting out the
// normal resend interval.
const BUNDLE_DROPPED_MIN_CONSECUTIVE_INVALID = 2;
const BUNDLE_DROPPED_MIN_AGE_MS = 10_000;

export async function sendJitoBundle(
  txs: Transaction[],
  signers: Keypair[][],
  tipper: Keypair,
  tipLamports: number,
  options?: SendJitoBundleOptions
) {
  const telemetry = options?.onEvent;
  const enableGrpc = options?.enableGrpc ?? true;
  const launchId = options?.launchId;
  const bundleLogger = launchId
    ? logger.child({ launchId, subsystem: "jito-bundle" })
    : logger.child({ subsystem: "jito-bundle" });
  const jitoClientLogOptions = launchId ? { launchId } : undefined;
  const adaptiveTipEnabled = options?.adaptiveTipEscalation?.enabled ?? false;
  const tipEscalationMultiplier = Math.max(
    1,
    options?.adaptiveTipEscalation?.multiplier ?? 2
  );
  const maxTipEscalations = Math.max(
    1,
    options?.adaptiveTipEscalation?.maxEscalations ?? 1
  );

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
  bundleLogger.info("Jito bundle send start", {
    txCount: txs.length,
    signerGroupCount: signers.length,
    tipLamports,
    tipper: tipper.publicKey.toBase58(),
    rpcEndpoint: connection.rpcEndpoint,
  });
  await emitBundleTelemetry(telemetry, {
    type: "bundle_send_start",
    data: {
      txCount: txs.length,
      signerGroupCount: signers.length,
      tipLamports,
      tipper: tipper.publicKey.toBase58(),
      rpcEndpoint: connection.rpcEndpoint,
      adaptiveTipEnabled,
      tipEscalationMultiplier,
      maxTipEscalations,
    },
  });
  const tipAccount = await getTipAccount(jitoClientLogOptions);
  bundleLogger.info("Jito tip account resolved", {
    tipAccount: tipAccount.toBase58(),
  });
  const baseBundleTxs = txs.map((tx) => {
    const clone = new Transaction();
    clone.add(...tx.instructions);
    clone.feePayer = tx.feePayer;
    return clone;
  });
  const feePayers = Array.from(
    new Set(
      baseBundleTxs
        .map((tx) => tx.feePayer?.toBase58())
        .filter((value): value is string => Boolean(value))
    )
  );
  let currentTipLamports = tipLamports;
  let tipEscalationCount = 0;

  function withTipTransactions(activeTipLamports: number) {
    const txCopies = baseBundleTxs.map((tx) => {
      const clone = new Transaction();
      clone.add(...tx.instructions);
      clone.feePayer = tx.feePayer;
      return clone;
    });
    const lastIdx = txCopies.length - 1;
    if (activeTipLamports > 0 && txCopies[lastIdx]) {
      txCopies[lastIdx].add(
        SystemProgram.transfer({
          fromPubkey: tipper.publicKey,
          toPubkey: tipAccount,
          lamports: activeTipLamports,
        })
      );
    }
    return txCopies;
  }

  let blockhashFetchedAt = Date.now();
  let { blockhash } = await connection.getLatestBlockhash("confirmed");
  bundleLogger.info("Bundle blockhash fetched", { blockhash });
  let currentBundleTxs = withTipTransactions(currentTipLamports);
  const altAccounts = options?.altAccounts ?? [];
  let currentBuild = buildVersionedTransactions(
    currentBundleTxs,
    signers,
    tipper,
    currentTipLamports,
    blockhash,
    altAccounts
  );
  bundleLogger.info("Bundle versioned transactions built", {
    signatureCount: currentBuild.signatures.length,
    signaturesPreview: currentBuild.signatures.slice(0, 3),
    feePayers,
    blockhash,
  });
  let currentProfiles = await profileVersionedTransactions({
    versionedTxs: currentBuild.versionedTxs,
    signatures: currentBuild.signatures,
    simulateTransaction: async (transaction) =>
      await connection.simulateTransaction(transaction, {
        sigVerify: false,
        commitment: "processed",
      }),
  });
  bundleLogger.info("Bundle transactions profiled", {
    blockhash,
    tipLamports: currentTipLamports,
    transactionCount: currentProfiles.length,
    transactions: currentProfiles,
  });
  await emitBundleTelemetry(telemetry, {
    type: "bundle_transactions_profiled",
    data: summarizeBundleProfiles({
      stage: "initial",
      rebuild: 0,
      blockhash,
      tipLamports: currentTipLamports,
      transactions: currentProfiles,
    }),
  });
  if (currentProfiles[0]?.simulationError) {
    bundleLogger.error("Bundle first transaction simulation failed", {
      error: currentProfiles[0].simulationError,
      logs: currentProfiles[0].simulationLogs,
      txIndex: currentProfiles[0].txIndex,
      signature: currentProfiles[0].signature,
    });
    const combined = `${String(currentProfiles[0].simulationError)}\n${(currentProfiles[0].simulationLogs ?? []).join("\n")}`;
    const mapped = mapPumpError(combined);
    if (mapped) throw mapped;
    throw new Error(`Transaction simulation failed: ${currentProfiles[0].simulationError}`);
  }
  if (currentProfiles[0]) {
    bundleLogger.info("Bundle first transaction simulation succeeded", {
      unitsConsumed: currentProfiles[0].unitsConsumed,
      serializedSizeBytes: currentProfiles[0].serializedSizeBytes,
      signature: currentProfiles[0].signature,
    });
  }

  // Sequential preflight: individually-simulated buy txs are expected to fail
  // pre-create (mint doesn't exist yet), so only a sequential bundle
  // simulation can validate the buys. Runs on the initial build only —
  // rebuilds keep the same instructions and only refresh the blockhash.
  const sequentialSimulation = await simulateBundleSequentially(
    currentBuild.versionedTxs,
    launchId ? { launchId } : undefined
  );
  if (sequentialSimulation.status === "ok") {
    bundleLogger.info("Bundle sequential simulation completed", {
      summaryError: sequentialSimulation.summaryError,
      failingTxIndex: sequentialSimulation.failingTxIndex,
      transactionResults: sequentialSimulation.transactionResults,
    });
    await emitBundleTelemetry(telemetry, {
      type: "bundle_sequential_simulation",
      data: {
        status: "ok",
        summaryError: sequentialSimulation.summaryError,
        failingTxIndex: sequentialSimulation.failingTxIndex,
        transactionResults: sequentialSimulation.transactionResults,
      },
    });
    if (
      sequentialSimulation.summaryError !== null ||
      sequentialSimulation.failingTxIndex !== null
    ) {
      const failingResult =
        sequentialSimulation.failingTxIndex !== null
          ? sequentialSimulation.transactionResults[
              sequentialSimulation.failingTxIndex
            ]
          : null;
      bundleLogger.error("Bundle sequential simulation failed", {
        summaryError: sequentialSimulation.summaryError,
        failingTxIndex: sequentialSimulation.failingTxIndex,
        failingTxError: failingResult?.err ?? null,
        failingTxLogs: failingResult?.logs ?? null,
      });
      const combined = `${failingResult?.err ?? sequentialSimulation.summaryError ?? ""}\n${(failingResult?.logs ?? []).join("\n")}`;
      const mapped = mapPumpError(combined);
      if (mapped) throw mapped;
      throw new Error(
        `Bundle sequential simulation failed at tx ${sequentialSimulation.failingTxIndex ?? "?"}: ${failingResult?.err ?? sequentialSimulation.summaryError}`
      );
    }
  } else {
    // Unsupported (no HELIUS_RPC_URL or non-Jito RPC) or transient error:
    // log and continue — preflight is diagnostic, not a hard gate.
    bundleLogger.warn("Bundle sequential simulation skipped", {
      status: sequentialSimulation.status,
      error: sequentialSimulation.error,
    });
    await emitBundleTelemetry(telemetry, {
      type: "bundle_sequential_simulation",
      data: {
        status: sequentialSimulation.status,
        error: sequentialSimulation.error,
      },
    });
  }

  function buildBundleFromVersionedTxs(vtxs: VersionedTransaction[]) {
    const container = new bundle.Bundle([], MAX_TRANSACTIONS_PER_BUNDLE);
    const result = container.addTransactions(...vtxs);
    if (result instanceof Error) {
      throw result;
    }
    return result;
  }

  let currentBundle = buildBundleFromVersionedTxs(currentBuild.versionedTxs);

  function createSendBundleWithRetries(bundleToSend: bundle.Bundle) {
    return async (): Promise<{ bundleId: string; endpoint: string | null }> => {
      let lastError: Error | null = null;
      for (let attempt = 1; attempt <= MAX_BUNDLE_SEND_ATTEMPTS; attempt += 1) {
        try {
          const result = await sendBundle(bundleToSend, jitoClientLogOptions);
          const endpoint =
            typeof result === "object" && result && "endpoint" in result &&
            typeof result.endpoint === "string"
              ? result.endpoint
              : null;
          if (result.rejections.length > 0) {
            await emitBundleTelemetry(telemetry, {
              type: "bundle_send_rejections",
              data: {
                attempt,
                accepted: result.ok,
                acceptedEndpoint: endpoint,
                rejections: result.rejections,
              },
            });
          }
          if (!result.ok) {
            const message =
              typeof result.error === "string"
                ? result.error
                : result.error?.message || "Jito bundle send failed";
            throw new Error(message);
          }
          return { bundleId: result.value, endpoint };
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
  }

  let sendBundleWithRetries = createSendBundleWithRetries(currentBundle);

  const initialSend = await sendBundleWithRetries();
  const initialBundleId = initialSend.bundleId;
  const initialEndpoint = initialSend.endpoint;
  bundleLogger.info("Jito bundle sent", {
    bundleId: initialBundleId,
    signatureCount: currentBuild.signatures.length,
    endpoint: initialEndpoint,
    tipLamports: currentTipLamports,
  });
  await emitBundleTelemetry(telemetry, {
    type: "bundle_sent",
    data: {
      bundleId: initialBundleId,
      signatureCount: currentBuild.signatures.length,
      endpoint: initialEndpoint,
      tipLamports: currentTipLamports,
      signatures: currentBuild.signatures,
      createSignature: currentBuild.signatures[0] ?? null,
      blockhash,
      blockhashFetchedAt,
    },
  });

  let rebuilds = 0;
  const rebuildAndResend = async (): Promise<{
    bundleId: string;
    endpoint: string | null;
    signatures: string[];
    blockhashFetchedAt: number;
  }> => {
    if (rebuilds >= MAX_BLOCKHASH_REBUILDS) {
      throw new Error(`Max blockhash rebuilds (${MAX_BLOCKHASH_REBUILDS}) exceeded`);
    }

    if (
      adaptiveTipEnabled &&
      currentTipLamports > 0 &&
      tipEscalationCount < maxTipEscalations
    ) {
      const previousTipLamports = currentTipLamports;
      currentTipLamports = Math.floor(currentTipLamports * tipEscalationMultiplier);
      tipEscalationCount += 1;
      bundleLogger.info("Adaptive tip escalation applied", {
        previousTipLamports,
        escalatedTipLamports: currentTipLamports,
        tipEscalationCount,
        maxTipEscalations,
      });
      await emitBundleTelemetry(telemetry, {
        type: "bundle_tip_escalated",
        data: {
          previousTipLamports,
          escalatedTipLamports: currentTipLamports,
          tipEscalationCount,
          maxTipEscalations,
          multiplier: tipEscalationMultiplier,
        },
      });
    }

    rebuilds += 1;

    blockhashFetchedAt = Date.now();
    const fresh = await connection.getLatestBlockhash("confirmed");
    blockhash = fresh.blockhash;

    bundleLogger.info("Rebuilding bundle with fresh blockhash", {
      rebuild: rebuilds,
      maxRebuilds: MAX_BLOCKHASH_REBUILDS,
      newBlockhash: blockhash,
      tipLamports: currentTipLamports,
    });

    currentBundleTxs = withTipTransactions(currentTipLamports);
    currentBuild = buildVersionedTransactions(
      currentBundleTxs,
      signers,
      tipper,
      currentTipLamports,
      blockhash,
      altAccounts
    );
    currentProfiles = await profileVersionedTransactions({
      versionedTxs: currentBuild.versionedTxs,
      signatures: currentBuild.signatures,
      simulateTransaction: async (transaction) =>
        await connection.simulateTransaction(transaction, {
          sigVerify: false,
          commitment: "processed",
        }),
    });
    bundleLogger.info("Rebuilt bundle transactions profiled", {
      rebuild: rebuilds,
      blockhash,
      tipLamports: currentTipLamports,
      transactionCount: currentProfiles.length,
      transactions: currentProfiles,
    });
    await emitBundleTelemetry(telemetry, {
      type: "bundle_transactions_profiled",
      data: summarizeBundleProfiles({
        stage: "rebuild",
        rebuild: rebuilds,
        blockhash,
        tipLamports: currentTipLamports,
        transactions: currentProfiles,
      }),
    });
    currentBundle = buildBundleFromVersionedTxs(currentBuild.versionedTxs);
    sendBundleWithRetries = createSendBundleWithRetries(currentBundle);

    const rebuiltSend = await sendBundleWithRetries();
    const newBundleId = rebuiltSend.bundleId;
    const newEndpoint = rebuiltSend.endpoint;

    bundleLogger.info("Bundle rebuilt and resent", {
      rebuild: rebuilds,
      bundleId: newBundleId,
      endpoint: newEndpoint,
      signatureCount: currentBuild.signatures.length,
      newBlockhash: blockhash,
      tipLamports: currentTipLamports,
    });
    await emitBundleTelemetry(telemetry, {
      type: "bundle_rebuilt",
      data: {
        rebuild: rebuilds,
        bundleId: newBundleId,
        endpoint: newEndpoint,
        signatureCount: currentBuild.signatures.length,
        newBlockhash: blockhash,
        tipLamports: currentTipLamports,
        signatures: currentBuild.signatures,
        createSignature: currentBuild.signatures[0] ?? null,
      },
    });

    return {
      bundleId: newBundleId,
      endpoint: newEndpoint,
      signatures: currentBuild.signatures,
      blockhashFetchedAt,
    };
  };

  const confirmedBundleId = await confirmBundleOnChain({
    connection,
    onEvent: telemetry,
    enableGrpc,
    initialSignatures: currentBuild.signatures,
    accountKeys: feePayers,
    initialBlockhashFetchedAt: blockhashFetchedAt,
    sendBundleWithRetries: () => sendBundleWithRetries(),
    bundleId: initialBundleId,
    bundleEndpoint: initialEndpoint,
    rebuildAndResend,
    bundleLogger,
    jitoClientLogOptions,
  });
  return { bundleId: confirmedBundleId, signatures: currentBuild.signatures };
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
  blockhash: string,
  altAccounts: AddressLookupTableAccount[] = []
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
    const allSigners = dedupeSigners(
      i === lastIdx && tipLamports > 0 ? [...txSigners, tipper] : txSigners
    );

    const messageV0 = new TransactionMessage({
      payerKey: tx.feePayer,
      recentBlockhash: blockhash,
      instructions: tx.instructions,
    }).compileToV0Message(altAccounts);

    const vTx = new VersionedTransaction(messageV0);
    vTx.sign(allSigners);
    versionedTxs.push(vTx);
    signatures.push(bs58.encode(vTx.signatures[0]));
  }

  return { versionedTxs, signatures };
}

function stringifySimulationError(error: unknown) {
  if (!error) {
    return null;
  }
  if (typeof error === "string") {
    return error;
  }
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function sanitizeSimulationLogs(
  logs: string[] | null | undefined,
  options?: { failed?: boolean }
) {
  if (!logs || logs.length === 0) {
    return null;
  }
  const truncateLine = (entry: string) => entry.slice(0, 500);
  // Failing transactions keep the full log (errors usually appear at the
  // tail, which head-only truncation used to cut off).
  if (options?.failed) {
    return logs.slice(0, 100).map(truncateLine);
  }
  if (logs.length <= 10) {
    return logs.map(truncateLine);
  }
  return [
    ...logs.slice(0, 5).map(truncateLine),
    `... ${logs.length - 10} log lines omitted ...`,
    ...logs.slice(-5).map(truncateLine),
  ];
}

export async function profileVersionedTransactions({
  versionedTxs,
  signatures,
  simulateTransaction,
}: {
  versionedTxs: VersionedTransaction[];
  signatures: string[];
  simulateTransaction: SimulateTransactionFn;
}): Promise<BundleTransactionProfile[]> {
  return await Promise.all(
    versionedTxs.map(async (transaction, txIndex) => {
      const simulation = await simulateTransaction(transaction);
      const simulationError = stringifySimulationError(simulation.value.err);
      return {
        txIndex,
        signature: signatures[txIndex] ?? null,
        instructionCount: transaction.message.compiledInstructions.length,
        signerCount: transaction.signatures.length,
        serializedSizeBytes: transaction.serialize().length,
        unitsConsumed: simulation.value.unitsConsumed ?? null,
        simulationError,
        simulationLogs: sanitizeSimulationLogs(simulation.value.logs, {
          failed: simulationError !== null,
        }),
      };
    })
  );
}

function summarizeBundleProfiles({
  stage,
  rebuild,
  blockhash,
  tipLamports,
  transactions,
}: {
  stage: "initial" | "rebuild";
  rebuild: number;
  blockhash: string;
  tipLamports: number;
  transactions: BundleTransactionProfile[];
}) {
  const serializedSizes = transactions.map(
    (transaction) => transaction.serializedSizeBytes
  );
  const consumedUnits = transactions
    .map((transaction) => transaction.unitsConsumed)
    .filter((value): value is number => value !== null);
  return {
    stage,
    rebuild,
    blockhash,
    tipLamports,
    transactionCount: transactions.length,
    failingSimulationCount: transactions.filter(
      (transaction) => transaction.simulationError !== null
    ).length,
    maxSerializedSizeBytes:
      serializedSizes.length > 0 ? Math.max(...serializedSizes) : 0,
    maxUnitsConsumed:
      consumedUnits.length > 0 ? Math.max(...consumedUnits) : null,
    transactions,
  };
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
  onEvent,
  enableGrpc,
  initialSignatures,
  accountKeys,
  initialBlockhashFetchedAt,
  sendBundleWithRetries,
  bundleId,
  bundleEndpoint,
  rebuildAndResend,
  bundleLogger,
  jitoClientLogOptions,
}: {
  connection: ReturnType<typeof getSolanaConnection>;
  onEvent?: BundleTelemetryHandler;
  enableGrpc: boolean;
  initialSignatures: string[];
  accountKeys: string[];
  initialBlockhashFetchedAt: number;
  sendBundleWithRetries: () => Promise<{
    bundleId: string;
    endpoint: string | null;
  }>;
  bundleId: string;
  bundleEndpoint: string | null;
  rebuildAndResend?: () => Promise<{
    bundleId: string;
    endpoint: string | null;
    signatures: string[];
    blockhashFetchedAt: number;
  }>;
  bundleLogger: typeof logger;
  jitoClientLogOptions?: { launchId: string };
}) {
  const startedAt = Date.now();
  let lastResendAt = startedAt;
  let currentBundleId = bundleId;
  let currentBundleEndpoint: string | null = bundleEndpoint;
  let currentSignatures = initialSignatures;
  let currentBlockhashFetchedAt = initialBlockhashFetchedAt;
  let lastSummary: BundleStatusSummary | null = null;
  let lastStatusError: string | null = null;
  let lastLoggedSummary: string | null = null;
  let lastLoggedStatusError: string | null = null;
  let lastInflightStatus: BundleInflightStatusSummary | null = null;
  let lastInflightStatusError: string | null = null;
  let consecutiveMatchedInvalidCount = 0;
  let lastLoggedInflightStatus: string | null = null;
  let lastLoggedInflightStatusError: string | null = null;
  const fallbackConnection = getFallbackConnection();
  bundleLogger.info("Bundle confirmation start", {
    bundleId,
    bundleEndpoint,
    signatureCount: currentSignatures.length,
    createSignature: currentSignatures[0],
    rpcEndpoint: connection.rpcEndpoint,
    fallbackRpcEndpoint: fallbackConnection?.rpcEndpoint ?? null,
    accountKeyCount: accountKeys.length,
  });
  await emitBundleTelemetry(onEvent, {
    type: "bundle_confirm_start",
    data: {
      bundleId,
      bundleEndpoint,
      signatureCount: currentSignatures.length,
      createSignature: currentSignatures[0] ?? null,
      rpcEndpoint: connection.rpcEndpoint,
      fallbackRpcEndpoint: fallbackConnection?.rpcEndpoint ?? null,
      accountKeyCount: accountKeys.length,
    },
  });
  const grpcState: {
    done: boolean;
    result: Set<string> | null;
    active: boolean;
  } = {
    done: false,
    result: null,
    active: false,
  };

  const grpcPromise = enableGrpc
    ? waitForSignaturesViaGrpc({
        signatures: currentSignatures,
        accountKeys,
        timeoutMs: BUNDLE_CONFIRM_TIMEOUT_MS,
      })
    : Promise.resolve(null);

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

  bundleLogger.info("Bundle confirmation mode", {
    grpcActive: grpcState.active,
    bundleId,
  });

  let currentInterval = grpcState.active
    ? BUNDLE_CONFIRM_RPC_SLOW_POLL_MS
    : BUNDLE_CONFIRM_INTERVAL_MS;
  let rateLimitCount = 0;
  let lastRpcCheckAt = 0;
  let lastBundleStatusCheckAt = 0;

  while (Date.now() - startedAt < BUNDLE_CONFIRM_TIMEOUT_MS) {
    if (grpcState.result?.has(currentSignatures[0])) {
      bundleLogger.info("Bundle confirmed via gRPC", {
        bundleId: currentBundleId,
        signature: currentSignatures[0],
        elapsedMs: Date.now() - startedAt,
      });
      return currentBundleId;
    }

    if (
      Date.now() - lastBundleStatusCheckAt >=
      BUNDLE_STATUS_CHECK_INTERVAL_MS
    ) {
      lastBundleStatusCheckAt = Date.now();
      const bundleStatusResult = await getBundleStatuses([currentBundleId], {
        ...jitoClientLogOptions,
      });
      if (bundleStatusResult.ok) {
        const match = bundleStatusResult.value.bundles.find(
          (entry) => entry.bundleId === currentBundleId
        );
        if (match) {
          const eventData = {
            bundleId: currentBundleId,
            bundleEndpoint: currentBundleEndpoint,
            statusEndpoint: bundleStatusResult.endpoint,
            slot: match.slot,
            confirmationStatus: match.confirmationStatus,
            err: match.err,
            elapsedMs: Date.now() - startedAt,
          };
          await emitBundleTelemetry(onEvent, {
            type: "bundle_status_check",
            data: eventData,
          });
          if (isJitoBundleStatusRetryable(match.err)) {
            bundleLogger.warn(
              "Bundle status check retryable; continuing poll",
              eventData
            );
          } else if (isJitoBundleStatusError(match.err)) {
            bundleLogger.warn("Bundle landed with on-chain error", eventData);
            throw new Error(
              `Bundle landed but failed on-chain: ${JSON.stringify(match.err)}`
            );
          } else if (
            match.confirmationStatus === "confirmed" ||
            match.confirmationStatus === "finalized"
          ) {
            bundleLogger.info("Bundle landed via getBundleStatuses", eventData);
            return currentBundleId;
          }
        }
      } else {
        await emitBundleTelemetry(onEvent, {
          type: "bundle_status_check_error",
          data: {
            bundleId: currentBundleId,
            error: bundleStatusResult.error,
            source: "bundle_statuses",
            elapsedMs: Date.now() - startedAt,
          },
        });
      }
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
          currentSignatures
        );
        const fallbackStatuses = fallbackConnection
          ? await fetchSignatureStatuses(fallbackConnection, currentSignatures)
          : null;
        const statuses = fallbackStatuses
          ? mergeSignatureStatuses(primaryStatuses, fallbackStatuses)
          : primaryStatuses;
        const summary = summarizeBundleStatuses(statuses);
        lastSummary = summary;
        lastStatusError = null;
        const inflightResult = await getInflightBundleStatuses(
          [currentBundleId],
          {
            preferEndpoint: currentBundleEndpoint,
            ...jitoClientLogOptions,
          }
        );
        if (inflightResult.ok) {
          const matchedStatus =
            inflightResult.value.bundles.find(
              (bundleStatus) => bundleStatus.bundleId === currentBundleId
            ) ??
            inflightResult.value.bundles[0] ??
            null;
          lastInflightStatus = matchedStatus
            ? {
                ...matchedStatus,
                endpoint: inflightResult.endpoint,
                contextSlot: inflightResult.value.contextSlot,
                matchedPreferred: inflightResult.matchedPreferred,
              }
            : null;
          lastInflightStatusError = null;
          if (
            lastInflightStatus?.status === "Invalid" &&
            lastInflightStatus.matchedPreferred
          ) {
            consecutiveMatchedInvalidCount += 1;
          } else {
            consecutiveMatchedInvalidCount = 0;
          }
          const inflightStatusKey = lastInflightStatus
            ? `${lastInflightStatus.status}:${lastInflightStatus.landedSlot}:${lastInflightStatus.endpoint}:${lastInflightStatus.contextSlot}`
            : "missing";
          if (inflightStatusKey !== lastLoggedInflightStatus) {
            bundleLogger.info("Bundle inflight status", {
              bundleId: currentBundleId,
              bundleEndpoint: currentBundleEndpoint,
              elapsedMs: Date.now() - startedAt,
              inflightStatus: lastInflightStatus?.status ?? null,
              inflightLandedSlot: lastInflightStatus?.landedSlot ?? null,
              inflightContextSlot: lastInflightStatus?.contextSlot ?? null,
              inflightEndpoint: lastInflightStatus?.endpoint ?? null,
            });
            await emitBundleTelemetry(onEvent, {
              type: "bundle_inflight_status",
              data: {
                bundleId: currentBundleId,
                bundleEndpoint: currentBundleEndpoint,
                elapsedMs: Date.now() - startedAt,
              inflightStatus: lastInflightStatus?.status ?? null,
              inflightLandedSlot: lastInflightStatus?.landedSlot ?? null,
              inflightContextSlot: lastInflightStatus?.contextSlot ?? null,
              inflightEndpoint: lastInflightStatus?.endpoint ?? null,
              inflightMatchedSendEndpoint:
                lastInflightStatus?.matchedPreferred ?? null,
              },
            });
            lastLoggedInflightStatus = inflightStatusKey;
          }
        } else {
          lastInflightStatus = null;
          lastInflightStatusError = inflightResult.error;
          if (lastInflightStatusError !== lastLoggedInflightStatusError) {
            bundleLogger.warn("Jito inflight status check error", {
              bundleId: currentBundleId,
              error: lastInflightStatusError,
              elapsedMs: Date.now() - startedAt,
            });
            await emitBundleTelemetry(onEvent, {
              type: "bundle_status_check_error",
              data: {
                bundleId: currentBundleId,
                error: lastInflightStatusError,
                elapsedMs: Date.now() - startedAt,
                source: "jito_inflight",
              },
            });
            lastLoggedInflightStatusError = lastInflightStatusError;
          }
        }

        if (rateLimitCount > 0) {
          rateLimitCount = 0;
          currentInterval = grpcState.active
            ? BUNDLE_CONFIRM_RPC_SLOW_POLL_MS
            : BUNDLE_CONFIRM_INTERVAL_MS;
        }

        const summaryKey = `${summary.foundCount}:${summary.confirmedCount}:${summary.failedCount}:${summary.notFoundCount}:${summary.createStatus}:${lastInflightStatus?.status ?? "unknown"}:${lastInflightStatus?.landedSlot ?? "none"}`;
        if (summaryKey !== lastLoggedSummary) {
          bundleLogger.info("Bundle confirmation summary", {
            bundleId: currentBundleId,
            bundleEndpoint: currentBundleEndpoint,
            elapsedMs: Date.now() - startedAt,
            blockhashAgeMs: Date.now() - currentBlockhashFetchedAt,
            grpcActive: grpcState.active,
            inflightStatus: lastInflightStatus?.status ?? null,
            inflightLandedSlot: lastInflightStatus?.landedSlot ?? null,
            inflightContextSlot: lastInflightStatus?.contextSlot ?? null,
            inflightEndpoint: lastInflightStatus?.endpoint ?? null,
            ...summary,
          });
          await emitBundleTelemetry(onEvent, {
            type: "bundle_confirm_summary",
            data: {
              bundleId: currentBundleId,
              bundleEndpoint: currentBundleEndpoint,
              elapsedMs: Date.now() - startedAt,
              blockhashAgeMs: Date.now() - currentBlockhashFetchedAt,
              grpcActive: grpcState.active,
              inflightStatus: lastInflightStatus?.status ?? null,
              inflightLandedSlot: lastInflightStatus?.landedSlot ?? null,
              inflightContextSlot: lastInflightStatus?.contextSlot ?? null,
              inflightEndpoint: lastInflightStatus?.endpoint ?? null,
              ...summary,
            },
          });
          lastLoggedSummary = summaryKey;
        }
        if (lastInflightStatus?.status === "Failed") {
          throw new Error(
            `Bundle failed in Jito block engine (bundleId=${currentBundleId})`
          );
        }
        if (lastInflightStatus?.status === "Landed") {
          bundleLogger.info("Bundle landed via inflight status", {
            bundleId: currentBundleId,
            landedSlot: lastInflightStatus.landedSlot,
            elapsedMs: Date.now() - startedAt,
          });
          return currentBundleId;
        }
        if (summary.createError) {
          bundleLogger.warn("Bundle create failed", {
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
        const blockhashAge = Date.now() - currentBlockhashFetchedAt;
        const inflightPending = lastInflightStatus?.status === "Pending";

        if (
          summary.foundCount === 0 &&
          blockhashAge >= BUNDLE_BLOCKHASH_MAX_AGE_MS &&
          rebuildAndResend &&
          !inflightPending
        ) {
          bundleLogger.warn("Blockhash expired, rebuilding bundle", {
            bundleId: currentBundleId,
            elapsedMs: Date.now() - startedAt,
            blockhashAgeMs: blockhashAge,
          });
          await emitBundleTelemetry(onEvent, {
            type: "bundle_rebuild_triggered",
            data: {
              bundleId: currentBundleId,
              elapsedMs: Date.now() - startedAt,
              blockhashAgeMs: blockhashAge,
              createStatus: summary.createStatus,
              foundCount: summary.foundCount,
              confirmedCount: summary.confirmedCount,
              failedCount: summary.failedCount,
              notFoundCount: summary.notFoundCount,
            },
          });
          try {
            const rebuilt = await rebuildAndResend();
            currentBundleId = rebuilt.bundleId;
            currentBundleEndpoint = rebuilt.endpoint;
            currentSignatures = rebuilt.signatures;
            currentBlockhashFetchedAt = rebuilt.blockhashFetchedAt;
            lastResendAt = Date.now();
            lastLoggedSummary = null;
            lastInflightStatus = null;
            lastInflightStatusError = null;
            lastLoggedInflightStatus = null;
            lastLoggedInflightStatusError = null;
            consecutiveMatchedInvalidCount = 0;
            continue;
          } catch (rebuildError) {
            const msg = rebuildError instanceof Error ? rebuildError.message : String(rebuildError);
            bundleLogger.warn("Bundle rebuild failed", {
              bundleId: currentBundleId,
              error: msg,
              elapsedMs: Date.now() - startedAt,
            });
          }
        }

        const droppedByEngine =
          summary.foundCount === 0 &&
          consecutiveMatchedInvalidCount >=
            BUNDLE_DROPPED_MIN_CONSECUTIVE_INVALID &&
          Date.now() - lastResendAt > BUNDLE_DROPPED_MIN_AGE_MS;

        if (droppedByEngine) {
          const rotatedEndpoint = currentBundleEndpoint
            ? rotatePreferredEndpointAwayFrom(currentBundleEndpoint)
            : null;
          bundleLogger.warn("Bundle dropped by block engine", {
            bundleId: currentBundleId,
            bundleEndpoint: currentBundleEndpoint,
            consecutiveInvalidReadings: consecutiveMatchedInvalidCount,
            rotatedToEndpoint: rotatedEndpoint,
            elapsedMs: Date.now() - startedAt,
            blockhashAgeMs: blockhashAge,
          });
          await emitBundleTelemetry(onEvent, {
            type: "bundle_dropped_by_engine",
            data: {
              bundleId: currentBundleId,
              bundleEndpoint: currentBundleEndpoint,
              consecutiveInvalidReadings: consecutiveMatchedInvalidCount,
              rotatedToEndpoint: rotatedEndpoint,
              elapsedMs: Date.now() - startedAt,
              blockhashAgeMs: blockhashAge,
              createStatus: summary.createStatus,
            },
          });
          consecutiveMatchedInvalidCount = 0;
          // Force the resend below to fire now instead of waiting out
          // BUNDLE_RESEND_INTERVAL_MS.
          lastResendAt = 0;
        }

        if (
          summary.foundCount === 0 &&
          blockhashAge < BUNDLE_BLOCKHASH_MAX_AGE_MS &&
          !inflightPending &&
          Date.now() - lastResendAt > BUNDLE_RESEND_INTERVAL_MS
        ) {
          bundleLogger.warn("Bundle resend triggered", {
            bundleId: currentBundleId,
            elapsedMs: Date.now() - startedAt,
            blockhashAgeMs: blockhashAge,
          });
          await emitBundleTelemetry(onEvent, {
            type: "bundle_resend_triggered",
            data: {
              bundleId: currentBundleId,
              elapsedMs: Date.now() - startedAt,
              blockhashAgeMs: blockhashAge,
              createStatus: summary.createStatus,
              foundCount: summary.foundCount,
              confirmedCount: summary.confirmedCount,
              failedCount: summary.failedCount,
              notFoundCount: summary.notFoundCount,
            },
          });
          const previousBundleId = currentBundleId;
          const previousEndpoint = currentBundleEndpoint;
          const resent = await sendBundleWithRetries();
          currentBundleId = resent.bundleId;
          currentBundleEndpoint = resent.endpoint;
          bundleLogger.info("Bundle resent", {
            previousBundleId,
            previousEndpoint,
            bundleId: currentBundleId,
            endpoint: currentBundleEndpoint,
          });
          await emitBundleTelemetry(onEvent, {
            type: "bundle_resent",
            data: {
              previousBundleId,
              previousEndpoint,
              bundleId: currentBundleId,
              endpoint: currentBundleEndpoint,
              elapsedMs: Date.now() - startedAt,
              blockhashAgeMs: blockhashAge,
            },
          });
          lastResendAt = Date.now();
          consecutiveMatchedInvalidCount = 0;
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
          bundleLogger.warn("Bundle status check error", {
            bundleId: currentBundleId,
            error: lastStatusError,
            elapsedMs: Date.now() - startedAt,
          });
          await emitBundleTelemetry(onEvent, {
            type: "bundle_status_check_error",
            data: {
              bundleId: currentBundleId,
              error: lastStatusError,
              elapsedMs: Date.now() - startedAt,
            },
          });
          lastLoggedStatusError = lastStatusError;
        }

        if (isRateLimitMessage(primaryError)) {
          rateLimitCount += 1;
          currentInterval = Math.min(
            BUNDLE_CONFIRM_INTERVAL_BACKOFF_MS * rateLimitCount,
            BUNDLE_CONFIRM_TIMEOUT_MS / 10
          );
          bundleLogger.info("Rate limit detected, backing off", {
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
  const bundleEndpointText = currentBundleEndpoint
    ? ` bundleEndpoint=${currentBundleEndpoint}`
    : "";
  const inflightSummaryText = lastInflightStatus
    ? ` inflightStatus=${lastInflightStatus.status} inflightLandedSlot=${lastInflightStatus.landedSlot ?? "null"} inflightEndpoint=${lastInflightStatus.endpoint}`
    : "";
  const inflightStatusErrorText = lastInflightStatusError
    ? ` inflightStatusError=${lastInflightStatusError}`
    : "";
  const statusErrorText = lastStatusError
    ? ` statusError=${lastStatusError}`
    : "";
  await emitBundleTelemetry(onEvent, {
    type: "bundle_confirm_timeout",
    data: {
      bundleId: currentBundleId,
      bundleEndpoint: currentBundleEndpoint,
      elapsedMs: Date.now() - startedAt,
      summary: lastSummary
        ? {
            foundCount: lastSummary.foundCount,
            confirmedCount: lastSummary.confirmedCount,
            failedCount: lastSummary.failedCount,
            notFoundCount: lastSummary.notFoundCount,
            createStatus: lastSummary.createStatus,
          }
        : null,
      inflight: lastInflightStatus
        ? {
            status: lastInflightStatus.status,
            landedSlot: lastInflightStatus.landedSlot,
            contextSlot: lastInflightStatus.contextSlot,
            endpoint: lastInflightStatus.endpoint,
          }
        : null,
      inflightStatusError: lastInflightStatusError,
      statusError: lastStatusError,
    },
  });
  throw new Error(
    `Bundle sent but CREATE transaction not confirmed on-chain (${summaryText}${bundleEndpointText}${inflightSummaryText}${statusErrorText}${inflightStatusErrorText})`
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

async function emitBundleTelemetry(
  onEvent: BundleTelemetryHandler | undefined,
  event: BundleTelemetryEvent
) {
  if (!onEvent) {
    return;
  }
  try {
    await onEvent(event);
  } catch (error) {
    logger.warn("Bundle telemetry handler failed", {
      eventType: event.type,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
