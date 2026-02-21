import { transactionService } from "@/server/services/transaction.service";
import { invalidateStatsCache } from "@/server/services/dashboard.service";

type TokenQueue = {
  signatures: Set<string>;
  timer: NodeJS.Timeout | null;
  flushing: boolean;
};

const BATCH_WINDOW_MS = 500;

class IngestionQueueService {
  private queues = new Map<string, TokenQueue>();

  enqueue(tokenPublicKey: string, signature: string) {
    let queue = this.queues.get(tokenPublicKey);
    if (!queue) {
      queue = { signatures: new Set(), timer: null, flushing: false };
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
      });
      invalidateStatsCache(tokenPublicKey);
    } catch (error) {
      console.error(
        `[IngestionQueue] Failed to ingest ${signatures.length} signatures for ${tokenPublicKey}:`,
        error instanceof Error ? error.message : error
      );
    } finally {
      queue.flushing = false;

      if (queue.signatures.size > 0) {
        queue.timer = setTimeout(() => this.flush(tokenPublicKey), BATCH_WINDOW_MS);
      } else {
        this.queues.delete(tokenPublicKey);
      }
    }
  }
}

export const ingestionQueue = new IngestionQueueService();
