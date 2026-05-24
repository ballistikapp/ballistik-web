import "server-only";
import type { Connection } from "@solana/web3.js";
import { prisma } from "@/lib/prisma";
import { getSolanaConnection } from "@/lib/solana/connection";
import { logger } from "@/lib/logger";

const log = logger.child({ service: "app-transaction-settler" });

const GET_TX_RETRY_ATTEMPTS = 5;
const GET_TX_RETRY_DELAY_MS = 1000;

type SettleRow = {
  id: string;
  walletPublicKey: string;
};

type SettleSignatureInput = {
  signature: string;
  rows: SettleRow[];
  connection?: Connection;
};

async function fetchTransactionWithRetry(
  connection: Connection,
  signature: string
) {
  for (let attempt = 0; attempt < GET_TX_RETRY_ATTEMPTS; attempt += 1) {
    const tx = await connection.getTransaction(signature, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    });
    if (tx) return tx;
    if (attempt < GET_TX_RETRY_ATTEMPTS - 1) {
      await new Promise((resolve) => setTimeout(resolve, GET_TX_RETRY_DELAY_MS));
    }
  }
  return null;
}

/**
 * Reads meta.preBalances/postBalances for the given signature once and writes
 * the signed lamport delta + tx fee share to each provided row. The delta is
 * the canonical P&L contribution of that row.
 *
 * Idempotent: a row that already has lamportsDelta set is left alone.
 */
export async function settleSignature(input: SettleSignatureInput): Promise<void> {
  if (input.rows.length === 0) return;

  const connection = input.connection ?? getSolanaConnection();
  const tx = await fetchTransactionWithRetry(connection, input.signature);

  if (!tx?.meta) {
    log.warn("settleSignature: transaction not found or missing meta", {
      signature: input.signature,
      rowCount: input.rows.length,
    });
    return;
  }

  // Read static keys directly. Calling getAccountKeys() without arguments
  // throws on v0 messages that carry addressTableLookups (the launch tx now
  // uses an ALT). Every wallet we track in AppTransaction is a signer or
  // fee payer, so it's always in staticAccountKeys; ALT-loaded keys are not
  // needed here. Both legacy Message and MessageV0 expose staticAccountKeys.
  const staticKeys = tx.transaction.message.staticAccountKeys.map((k) =>
    k.toBase58()
  );
  const feePayerKey = staticKeys[0] ?? null;
  const feeLamports = tx.meta.fee ?? 0;
  const blockTime = tx.blockTime ? new Date(tx.blockTime * 1000) : null;

  for (const row of input.rows) {
    const idx = staticKeys.indexOf(row.walletPublicKey);
    if (idx < 0) {
      log.warn("settleSignature: wallet not in tx accountKeys", {
        signature: input.signature,
        walletPublicKey: row.walletPublicKey,
        rowId: row.id,
      });
      continue;
    }

    const pre = tx.meta.preBalances[idx] ?? 0;
    const post = tx.meta.postBalances[idx] ?? 0;
    const deltaLamports = BigInt(post) - BigInt(pre);
    const txFeeShare = row.walletPublicKey === feePayerKey ? feeLamports : 0;

    try {
      await prisma.appTransaction.update({
        where: { id: row.id },
        data: {
          lamportsDelta: deltaLamports,
          solAmount: Number(deltaLamports) / 1_000_000_000,
          txFeeLamports: txFeeShare,
          blockTime: blockTime ?? undefined,
          transactionSignature: input.signature,
        },
      });
    } catch (err) {
      log.warn("settleSignature: failed to update row", {
        signature: input.signature,
        rowId: row.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

/**
 * Settle a Jito bundle: each transaction in the bundle has its own signature,
 * and rows are grouped by their bundle index. groups[i] is the array of rows
 * tied to signatures[i].
 */
export async function settleBundle(input: {
  signatures: string[];
  groups: SettleRow[][];
  connection?: Connection;
}): Promise<void> {
  const connection = input.connection ?? getSolanaConnection();
  const limit = Math.min(input.signatures.length, input.groups.length);
  for (let i = 0; i < limit; i += 1) {
    const signature = input.signatures[i];
    const rows = input.groups[i];
    if (!signature || rows.length === 0) continue;
    await settleSignature({ signature, rows, connection });
  }
}

/**
 * Backstop sweep: finds CONFIRMED rows missing lamportsDelta and re-settles
 * them. Bounded so a single dashboard call does not balloon into a long task.
 */
export async function settleUnsettledForToken(input: {
  userId: string;
  tokenPublicKey: string;
  limit?: number;
}): Promise<{ attempted: number; settled: number }> {
  const limit = input.limit ?? 50;
  const rows = await prisma.appTransaction.findMany({
    where: {
      userId: input.userId,
      tokenPublicKey: input.tokenPublicKey,
      status: "CONFIRMED",
      lamportsDelta: null,
      transactionSignature: { not: null },
      walletPublicKey: { not: null },
    },
    select: { id: true, transactionSignature: true, walletPublicKey: true },
    orderBy: { createdAt: "desc" },
    take: limit,
  });

  if (rows.length === 0) return { attempted: 0, settled: 0 };

  const bySignature = new Map<string, SettleRow[]>();
  for (const r of rows) {
    if (!r.transactionSignature || !r.walletPublicKey) continue;
    const existing = bySignature.get(r.transactionSignature) ?? [];
    existing.push({ id: r.id, walletPublicKey: r.walletPublicKey });
    bySignature.set(r.transactionSignature, existing);
  }

  const connection = getSolanaConnection();
  let settled = 0;
  for (const [signature, group] of bySignature) {
    try {
      await settleSignature({ signature, rows: group, connection });
      settled += group.length;
    } catch (err) {
      log.warn("Backstop settle failed", {
        signature,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { attempted: rows.length, settled };
}
