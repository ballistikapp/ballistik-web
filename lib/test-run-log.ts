import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

export type TestRunLoggingState = {
  enabled: boolean;
  runId: string | null;
  logPath: string | null;
};

export type TestRunLogEventInput = {
  eventType: string;
  source?: string;
  tokenPublicKey?: string;
  page?: string;
  action?: string;
  userId?: string;
  wallets?: unknown;
  balancesBefore?: unknown;
  balancesAfter?: unknown;
  expectedValue?: unknown;
  actualValue?: unknown;
  delta?: unknown;
  notes?: unknown;
  status?: string;
  trigger?: string;
  durationMs?: number;
  signature?: string;
  sessionId?: string;
  launchId?: string;
  refreshMode?: string;
  dataSource?: string;
  cache?: unknown;
  summary?: unknown;
  snapshot?: unknown;
  error?: unknown;
  [key: string]: unknown;
};

type LoggingStateOptions = {
  env?: NodeJS.ProcessEnv;
  cwd?: string;
};

type AppendOptions = {
  enabled?: boolean;
  runId?: string | null;
  logPath?: string | null;
  timestamp?: Date;
} & LoggingStateOptions;

const MAX_SERIALIZE_DEPTH = 6;
const MAX_OBJECT_KEYS = 100;
const MAX_ARRAY_ITEMS = 100;
const MAX_STRING_LENGTH = 5000;
const MAX_JSONL_BYTES = 100_000;

function isTruthy(value?: string): boolean {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

function sanitizeRunId(runId: string): string {
  return runId.replace(/[^a-zA-Z0-9._-]/g, "-");
}

function createGeneratedRunId(): string {
  const timestamp = new Date().toISOString().replace(/[:]/g, "-");
  return `test-run-${timestamp}-${randomUUID().slice(0, 8)}`;
}

let generatedRunId: string | null = null;

function getOrCreateRunId(explicitRunId?: string | null): string {
  if (explicitRunId && explicitRunId.trim()) {
    return sanitizeRunId(explicitRunId.trim());
  }
  if (!generatedRunId) {
    generatedRunId = sanitizeRunId(createGeneratedRunId());
  }
  return generatedRunId;
}

export function getTestRunLoggingState(
  options?: LoggingStateOptions
): TestRunLoggingState {
  const env = options?.env ?? process.env;
  const cwd = options?.cwd ?? process.cwd();
  const enabled = isTruthy(env.TEST_RUN_LOG_ENABLED);

  if (!enabled) {
    return {
      enabled: false,
      runId: null,
      logPath: null,
    };
  }

  const runId = getOrCreateRunId(env.TEST_RUN_ID);
  const logPath =
    env.TEST_RUN_LOG_PATH?.trim() ||
    path.join(cwd, "logs", "test-runs", `${runId}.jsonl`);

  return {
    enabled: true,
    runId,
    logPath,
  };
}

function serializeValue(
  value: unknown,
  options?: {
    depth?: number;
    seen?: WeakSet<object>;
  }
): unknown {
  const depth = options?.depth ?? 0;
  const seen = options?.seen ?? new WeakSet<object>();
  if (depth > MAX_SERIALIZE_DEPTH) {
    return "[MaxDepthExceeded]";
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (value instanceof Error) {
    return {
      errorName: value.name,
      errorMessage: value.message,
      ...(value.stack ? { errorStack: value.stack } : {}),
    };
  }
  if (typeof value === "bigint") {
    return value.toString();
  }
  if (typeof value === "string" && value.length > MAX_STRING_LENGTH) {
    return `${value.slice(0, MAX_STRING_LENGTH)}...[Truncated]`;
  }
  if (Array.isArray(value)) {
    return value
      .slice(0, MAX_ARRAY_ITEMS)
      .map((item) => serializeValue(item, { depth: depth + 1, seen }));
  }
  if (value && typeof value === "object") {
    if (seen.has(value)) {
      return "[Circular]";
    }
    seen.add(value);
    return Object.fromEntries(
      Object.entries(value)
        .slice(0, MAX_OBJECT_KEYS)
        .map(([key, nestedValue]) => [
          key,
          serializeValue(nestedValue, { depth: depth + 1, seen }),
        ])
    );
  }
  return value;
}

export async function appendTestRunLogEvent(
  event: TestRunLogEventInput,
  options?: AppendOptions
): Promise<{ written: boolean; runId: string | null; logPath: string | null }> {
  const resolved =
    options?.enabled === undefined &&
    options?.runId === undefined &&
    options?.logPath === undefined
      ? getTestRunLoggingState(options)
      : {
          enabled: options?.enabled ?? false,
          runId: options?.runId ?? null,
          logPath: options?.logPath ?? null,
        };

  if (!resolved.enabled || !resolved.runId || !resolved.logPath) {
    return {
      written: false,
      runId: resolved.runId,
      logPath: resolved.logPath,
    };
  }

  try {
    const entry = serializeValue({
      runId: resolved.runId,
      timestamp: (options?.timestamp ?? new Date()).toISOString(),
      ...event,
    });
    const line = JSON.stringify(entry);
    const boundedLine =
      line.length > MAX_JSONL_BYTES
        ? JSON.stringify({
            runId: resolved.runId,
            timestamp: (options?.timestamp ?? new Date()).toISOString(),
            eventType: event.eventType,
            source: event.source ?? null,
            warning: "[TruncatedLargeEvent]",
            originalSizeBytes: line.length,
          })
        : line;

    await mkdir(path.dirname(resolved.logPath), { recursive: true });
    await appendFile(resolved.logPath, `${boundedLine}\n`, "utf8");

    return {
      written: true,
      runId: resolved.runId,
      logPath: resolved.logPath,
    };
  } catch {
    console.error(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        level: "error",
        message: "Failed to append test run log event",
        runId: resolved.runId,
        logPath: resolved.logPath,
        eventType: event.eventType,
      })
    );
    return {
      written: false,
      runId: resolved.runId,
      logPath: resolved.logPath,
    };
  }
}
