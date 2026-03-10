import "@/lib/suppress-bigint-warning";

type LogLevel = "debug" | "info" | "warn" | "error";

export type LogContext = Record<string, unknown>;

export type LogEntry = {
  timestamp: string;
  level: LogLevel;
  message: string;
} & LogContext;

export type LogTransport = (entry: LogEntry) => void | Promise<void>;

const levelOrder: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

function parseLogLevel(value?: string): LogLevel {
  const normalized = value?.toLowerCase();
  if (normalized === "debug") return "debug";
  if (normalized === "info") return "info";
  if (normalized === "warn") return "warn";
  if (normalized === "error") return "error";
  return "info";
}

const defaultTransport: LogTransport = (entry) => {
  const payload = JSON.stringify(entry);
  if (entry.level === "error") {
    console.error(payload);
    return;
  }
  console.log(payload);
};

function createRuntimeTransport(): LogTransport {
  return defaultTransport;
}

class Logger {
  private baseContext: LogContext;
  private transport: LogTransport;
  private minLevel: LogLevel;

  constructor(options?: {
    baseContext?: LogContext;
    transport?: LogTransport;
    minLevel?: LogLevel;
  }) {
    this.baseContext = options?.baseContext ?? {};
    this.transport = options?.transport ?? createRuntimeTransport();
    this.minLevel = options?.minLevel ?? parseLogLevel(process.env.LOG_LEVEL);
  }

  setTransport(transport: LogTransport) {
    this.transport = transport;
  }

  setLevel(level: LogLevel) {
    this.minLevel = level;
  }

  child(context: LogContext) {
    return new Logger({
      baseContext: { ...this.baseContext, ...context },
      transport: this.transport,
      minLevel: this.minLevel,
    });
  }

  private shouldLog(level: LogLevel) {
    return levelOrder[level] >= levelOrder[this.minLevel];
  }

  private normalizeContext(
    context?: LogContext | Error | unknown,
    extra?: unknown[]
  ): LogContext {
    const normalized: LogContext = {};
    if (context instanceof Error) {
      normalized.errorName = context.name;
      normalized.errorMessage = context.message;
      if (context.stack) {
        normalized.errorStack = context.stack;
      }
    } else if (context && typeof context === "object" && !Array.isArray(context)) {
      Object.assign(normalized, context as LogContext);
    } else if (context !== undefined) {
      normalized.value = context;
    }
    if (extra && extra.length > 0) {
      normalized.extra = extra;
    }
    return normalized;
  }

  private log(
    level: LogLevel,
    message: string,
    context?: LogContext | Error | unknown,
    ...extra: unknown[]
  ) {
    if (!this.shouldLog(level)) {
      return;
    }
    const normalizedContext = this.normalizeContext(context, extra);
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      ...this.baseContext,
      ...normalizedContext,
    };
    this.transport(entry);
    return entry;
  }

  error(message: string, context?: LogContext | Error | unknown, ...extra: unknown[]) {
    return this.log("error", message, context, ...extra);
  }

  warn(message: string, context?: LogContext | Error | unknown, ...extra: unknown[]) {
    return this.log("warn", message, context, ...extra);
  }

  info(message: string, context?: LogContext | Error | unknown, ...extra: unknown[]) {
    return this.log("info", message, context, ...extra);
  }

  debug(message: string, context?: LogContext | Error | unknown, ...extra: unknown[]) {
    return this.log("debug", message, context, ...extra);
  }
}

export const logger = new Logger();
