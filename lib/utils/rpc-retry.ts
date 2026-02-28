const MAX_RETRIES = 2;
const BASE_DELAY_MS = 500;

function isTransientRpcError(error: unknown): boolean {
  const message =
    error instanceof Error
      ? error.message.toLowerCase()
      : String(error).toLowerCase();
  return (
    message.includes("429") ||
    message.includes("502") ||
    message.includes("503") ||
    message.includes("504") ||
    message.includes("timeout") ||
    message.includes("timed out") ||
    message.includes("econnreset") ||
    message.includes("fetch failed") ||
    message.includes("socket hang up")
  );
}

export async function retryRpc<T>(fn: () => Promise<T>): Promise<T> {
  let attempt = 0;
  while (true) {
    try {
      return await fn();
    } catch (error) {
      if (!isTransientRpcError(error) || attempt >= MAX_RETRIES) {
        throw error;
      }
      const backoffMs = BASE_DELAY_MS * 2 ** attempt;
      await new Promise((resolve) => setTimeout(resolve, backoffMs));
      attempt += 1;
    }
  }
}

export async function retryRpcWithTimeout<T>(
  fn: () => Promise<T>,
  timeoutMs = 30_000
): Promise<T> {
  return retryRpc(() =>
    new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("RPC timeout"));
      }, timeoutMs);

      fn()
        .then(resolve)
        .catch(reject)
        .finally(() => {
          clearTimeout(timeout);
        });
    })
  );
}
