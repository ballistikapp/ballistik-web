import "server-only";
type RetryLaunchDbWriteOptions = {
  maxAttempts?: number;
  baseDelayMs?: number;
  sleep?: (delayMs: number) => Promise<void>;
};

const RETRYABLE_LAUNCH_DB_ERROR_CODES = new Set([
  "P1001",
  "P1002",
  "P1008",
  "P2024",
  "P2034",
  "P6004",
]);

const RETRYABLE_LAUNCH_DB_MESSAGE_FRAGMENTS = [
  "operation has timed out",
  "timed out fetching a new connection from the connection pool",
  "connection pool",
  "can't reach database server",
  "connection terminated unexpectedly",
  "connection reset",
  "too many connections",
];

function getErrorCode(error: unknown) {
  if (!error || typeof error !== "object") {
    return null;
  }

  const code = "code" in error ? error.code : null;
  return typeof code === "string" ? code : null;
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  if (!error || typeof error !== "object") {
    return String(error ?? "");
  }

  const message = "message" in error ? error.message : null;
  return typeof message === "string" ? message : String(error);
}

export function isRetryableLaunchDbError(error: unknown) {
  const code = getErrorCode(error);
  if (code && RETRYABLE_LAUNCH_DB_ERROR_CODES.has(code)) {
    return true;
  }

  const message = getErrorMessage(error).toLowerCase();
  return RETRYABLE_LAUNCH_DB_MESSAGE_FRAGMENTS.some((fragment) =>
    message.includes(fragment)
  );
}

export async function retryLaunchDbWrite<T>(
  operation: () => Promise<T>,
  options: RetryLaunchDbWriteOptions = {}
): Promise<T> {
  const {
    maxAttempts = 3,
    baseDelayMs = 250,
    sleep = (delayMs: number) =>
      new Promise<void>((resolve) => setTimeout(resolve, delayMs)),
  } = options;

  let attempt = 0;
  let lastError: unknown;

  while (attempt < maxAttempts) {
    attempt += 1;
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (!isRetryableLaunchDbError(error) || attempt >= maxAttempts) {
        throw error;
      }

      await sleep(baseDelayMs * 2 ** (attempt - 1));
    }
  }

  throw lastError;
}
