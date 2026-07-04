import "server-only";

import type { VersionedTransaction } from "@solana/web3.js";
import { getEnv } from "@/lib/config/env";
import { logger } from "@/lib/logger";

// simulateBundle is a Jito-Solana RPC method (not part of standard web3.js).
// It simulates all transactions sequentially against a single bank state, so
// later transactions see the effects of earlier ones — the only way to
// validate a create-and-buy bundle where buys depend on the CREATE tx.
// Requires an RPC provider running Jito-Solana (e.g. Helius, Triton).

export type SimulateBundleTransactionResult = {
  txIndex: number;
  err: string | null;
  logs: string[] | null;
  unitsConsumed: number | null;
};

export type SimulateBundleResult =
  | {
      status: "ok";
      summaryError: string | null;
      failingTxIndex: number | null;
      transactionResults: SimulateBundleTransactionResult[];
    }
  | { status: "unsupported"; error: string }
  | { status: "error"; error: string };

export function getSimulateBundleRpcUrl(): string | null {
  return getEnv().HELIUS_RPC_URL ?? null;
}

function stringifyError(err: unknown): string | null {
  if (err === null || err === undefined) return null;
  if (typeof err === "string") return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseTransactionResults(
  rawResults: unknown
): SimulateBundleTransactionResult[] {
  if (!Array.isArray(rawResults)) return [];
  return rawResults.map((entry, txIndex) => {
    if (!isRecord(entry)) {
      return { txIndex, err: null, logs: null, unitsConsumed: null };
    }
    return {
      txIndex,
      err: stringifyError(entry.err),
      logs: Array.isArray(entry.logs)
        ? entry.logs.filter((line): line is string => typeof line === "string")
        : null,
      unitsConsumed:
        typeof entry.unitsConsumed === "number" ? entry.unitsConsumed : null,
    };
  });
}

export async function simulateBundleSequentially(
  versionedTxs: VersionedTransaction[],
  options?: { launchId?: string }
): Promise<SimulateBundleResult> {
  const rpcUrl = getSimulateBundleRpcUrl();
  if (!rpcUrl) {
    return {
      status: "unsupported",
      error: "HELIUS_RPC_URL not configured",
    };
  }

  const logContext = options?.launchId ? { launchId: options.launchId } : {};
  const encodedTransactions = versionedTxs.map((tx) =>
    Buffer.from(tx.serialize()).toString("base64")
  );

  try {
    const response = await fetch(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "simulateBundle",
        params: [
          { encodedTransactions },
          {
            encoding: "base64",
            commitment: "processed",
            replaceRecentBlockhash: true,
            skipSigVerify: true,
            // Required whenever replaceRecentBlockhash is set, even if we
            // don't need pre/post account snapshots. Must be one entry per
            // transaction (null = no snapshot requested for that tx).
            preExecutionAccountsConfigs: encodedTransactions.map(() => null),
            postExecutionAccountsConfigs: encodedTransactions.map(() => null),
          },
        ],
      }),
    });

    if (!response.ok) {
      const bodyText = await response.text().catch(() => "");
      return {
        status: "error",
        error: `simulateBundle HTTP ${response.status}: ${bodyText.slice(0, 300)}`,
      };
    }

    const payload: unknown = await response.json();
    if (!isRecord(payload)) {
      return { status: "error", error: "Invalid simulateBundle response" };
    }

    if (isRecord(payload.error)) {
      const message =
        typeof payload.error.message === "string"
          ? payload.error.message
          : JSON.stringify(payload.error);
      // -32601 = method not found → the RPC does not run Jito-Solana
      if (
        payload.error.code === -32601 ||
        message.toLowerCase().includes("method not found")
      ) {
        return { status: "unsupported", error: message };
      }
      return { status: "error", error: message };
    }

    const result = isRecord(payload.result) ? payload.result : null;
    const value = result && isRecord(result.value) ? result.value : null;
    if (!value) {
      return { status: "error", error: "Missing simulateBundle result value" };
    }

    const transactionResults = parseTransactionResults(
      value.transactionResults
    );
    const summaryError =
      value.summary === "succeeded" || value.summary === undefined
        ? null
        : stringifyError(value.summary);
    const failingTxIndex = (() => {
      const failing = transactionResults.find((entry) => entry.err !== null);
      if (failing) return failing.txIndex;
      // Bundle failed on a tx whose result wasn't returned (Jito-Solana only
      // returns results up to and including the failing transaction).
      if (summaryError !== null && transactionResults.length < versionedTxs.length) {
        return transactionResults.length;
      }
      return null;
    })();

    return { status: "ok", summaryError, failingTxIndex, transactionResults };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn("simulateBundle request failed", { ...logContext, error: message });
    return { status: "error", error: message };
  }
}
