import "server-only";
import { transactionService } from "@/server/services/transaction.service";
import { invalidateStatsCache } from "@/server/services/dashboard.service";
import { dashboardEvents } from "@/server/events/dashboard-events";
import { logger } from "@/lib/logger";
import { PendingSignatureIngestionError } from "@/server/services/transaction.service";

type TokenQueue = {
  signatures: Set<string>;
  timer: NodeJS.Timeout | null;
  flushing: boolean;
  retryCount: number;
  totalProcessed: number;
  totalFailures: number;
  lastFailureAt: string | null;
  lastFailureReason: string | null;
};

const BATCH_WINDOW_MS = 500;
const MAX_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 1_000;
const log = logger.child({ service: "ingestion-queue" });

class IngestionQueueService {
  private queues = new Map<string, TokenQueue>();

  enqueue(tokenPublicKey: string, signature: string) {
    let queue = this.queues.get(tokenPublicKey);
    if (!queue) {
      queue = {
        signatures: new Set(),
        timer: null,
        flushing: false,
        retryCount: 0,
        totalProcessed: 0,
        totalFailures: 0,
        lastFailureAt: null,
        lastFailureReason: null,
      };
      this.queues.set(tokenPublicKey, queue);
    }

    queue.signatures.add(signature);

    if (!queue.flushing) {
      if (queue.timer) clearTimeout(queue.timer);
      queue.timer = setTimeout(() => this.flush(tokenPublicKey), BATCH_WINDOW_MS);
    }
  }

  private async flush(tokenPublicKey: string) {
    const queue = this.queues.get(tokenPublicKey);
    if (!queue || queue.signatures.size === 0 || queue.flushing) return;

    queue.flushing = true;
    const signatures = Array.from(queue.signatures);
    queue.signatures.clear();
    queue.timer = null;

    try {
      await transactionService.ingestTokenSignatures({
        tokenPublicKey,
        signatures,
        requireAllParsed: true,
      });
      invalidateStatsCache(tokenPublicKey);
      dashboardEvents.emitIngestionComplete({ tokenPublicKey, signatureCount: signatures.length });
      queue.retryCount = 0;
      queue.totalProcessed += signatures.length;
    } catch (error) {
      const retrySignatures =
        error instanceof PendingSignatureIngestionError
          ? error.signatures
          : signatures;
      const message = error instanceof Error ? error.message : String(error);
      queue.totalFailures += retrySignatures.length;
      queue.lastFailureAt = new Date().toISOString();
      queue.lastFailureReason = message;
      queue.retryCount += 1;
      retrySignatures.forEach((signature) => queue?.signatures.add(signature));

      if (error instanceof PendingSignatureIngestionError) {
        log.warn("Signatures not yet parseable, retrying unresolved subset", {
          tokenPublicKey,
          originalBatchCount: signatures.length,
          retrySignatureCount: retrySignatures.length,
          retryCount: queue.retryCount,
        });
      } else {
        log.error("Failed to ingest signatures batch", {
          tokenPublicKey,
          signatureCount: signatures.length,
          retryCount: queue.retryCount,
          error: message,
        });
      }
    } finally {
      queue.flushing = false;

      if (queue.signatures.size > 0) {
        const retryDelay =
          queue.retryCount > 0
            ? Math.min(
                RETRY_BASE_DELAY_MS * 2 ** (queue.retryCount - 1),
                10_000
              )
            : BATCH_WINDOW_MS;
        if (queue.retryCount > MAX_RETRIES) {
          log.error("Exceeded ingestion retry limit; deferring to polling fallback", {
            tokenPublicKey,
            pendingSignatures: queue.signatures.size,
            lastFailureAt: queue.lastFailureAt,
            lastFailureReason: queue.lastFailureReason,
          });
          queue.retryCount = MAX_RETRIES;
          queue.timer = setTimeout(() => this.flush(tokenPublicKey), 30_000);
          return;
        }
        queue.timer = setTimeout(() => this.flush(tokenPublicKey), retryDelay);
      } else {
        this.queues.delete(tokenPublicKey);
      }
    }
  }

  getStatus() {
    const tokens = Array.from(this.queues.entries()).map(([tokenPublicKey, queue]) => ({
      tokenPublicKey,
      pendingSignatures: queue.signatures.size,
      flushing: queue.flushing,
      retryCount: queue.retryCount,
      totalProcessed: queue.totalProcessed,
      totalFailures: queue.totalFailures,
      lastFailureAt: queue.lastFailureAt,
      lastFailureReason: queue.lastFailureReason,
    }));

    return {
      queueCount: tokens.length,
      tokens,
    };
  }
}

export const ingestionQueue = new IngestionQueueService();
