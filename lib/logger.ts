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

type LokiConfig = {
  url: string;
  username: string;
  token: string;
  environment: string;
  defaultService: string;
  maxBatchSize: number;
  flushIntervalMs: number;
};

function parseBoolean(value?: string): boolean {
  return value === "true";
}

function getLokiPushUrl(value: string): string {
  const normalized = value.trim().replace(/\/$/, "");
  if (normalized.endsWith("/loki/api/v1/push")) {
    return normalized;
  }
  return `${normalized}/loki/api/v1/push`;
}

class LokiTransport {
  private readonly config: LokiConfig;
  private readonly queue: LogEntry[] = [];
  private timer: NodeJS.Timeout | null = null;
  private flushing = false;
  private shutdownHandlersRegistered = false;

  constructor(config: LokiConfig) {
    this.config = config;
    this.registerShutdownHandlers();
  }

  enqueue(entry: LogEntry) {
    this.queue.push(entry);
    if (this.queue.length >= this.config.maxBatchSize) {
      void this.flush();
      return;
    }
    this.ensureTimer();
  }

  async flushAll() {
    while (this.queue.length > 0) {
      await this.flush();
    }
  }

  private ensureTimer() {
    if (this.timer) {
      return;
    }
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, this.config.flushIntervalMs);
  }

  private clearTimer() {
    if (!this.timer) {
      return;
    }
    clearTimeout(this.timer);
    this.timer = null;
  }

  private toLokiNsTimestamp(timestamp: string): string {
    const millis = Date.parse(timestamp);
    const value = Number.isFinite(millis) ? millis : Date.now();
    return `${Math.floor(value * 1_000_000)}`;
  }

  private getServiceLabel(entry: LogEntry): string {
    const service = entry.service;
    if (typeof service === "string" && service.trim().length > 0) {
      return service.trim();
    }
    return this.config.defaultService;
  }

  private buildStreams(batch: LogEntry[]) {
    const streams = new Map<
      string,
      { stream: Record<string, string>; values: [string, string][] }
    >();

    batch.forEach((entry) => {
      const service = this.getServiceLabel(entry);
      const key = `${service}:${entry.level}`;
      if (!streams.has(key)) {
        streams.set(key, {
          stream: {
            service,
            env: this.config.environment,
            level: entry.level,
          },
          values: [],
        });
      }
      const target = streams.get(key);
      if (!target) {
        return;
      }
      target.values.push([
        this.toLokiNsTimestamp(entry.timestamp),
        JSON.stringify(entry),
      ]);
    });

    return Array.from(streams.values());
  }

  private async flush() {
    if (this.flushing || this.queue.length === 0) {
      return;
    }

    this.flushing = true;
    this.clearTimer();

    const batch = this.queue.splice(0, this.config.maxBatchSize);

    try {
      const body = JSON.stringify({
        streams: this.buildStreams(batch),
      });

      const authToken = Buffer.from(
        `${this.config.username}:${this.config.token}`
      ).toString("base64");

      const response = await fetch(this.config.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Basic ${authToken}`,
        },
        body,
      });
      if (!response.ok) {
        this.queue.unshift(...batch);
      }
    } catch {
      this.queue.unshift(...batch);
    } finally {
      this.flushing = false;
      if (this.queue.length > 0) {
        this.ensureTimer();
      }
    }
  }

  private registerShutdownHandlers() {
    if (this.shutdownHandlersRegistered) {
      return;
    }
    this.shutdownHandlersRegistered = true;

    process.on("beforeExit", () => {
      void this.flushAll();
    });
    process.on("SIGTERM", () => {
      void this.flushAll();
    });
    process.on("SIGINT", () => {
      void this.flushAll();
    });
  }
}

function createRuntimeTransport(): LogTransport {
  const transports: LogTransport[] = [defaultTransport];

  const isProduction = process.env.NODE_ENV === "production";
  const lokiEnabled = parseBoolean(process.env.LOKI_ENABLED);
  const lokiUrl = process.env.LOKI_URL;
  const lokiUsername = process.env.LOKI_USERNAME;
  const lokiToken = process.env.LOKI_API_TOKEN;

  if (isProduction && lokiEnabled && lokiUrl && lokiUsername && lokiToken) {
    const lokiTransport = new LokiTransport({
      url: getLokiPushUrl(lokiUrl),
      username: lokiUsername,
      token: lokiToken,
      environment: process.env.RAILWAY_ENVIRONMENT_NAME ?? "production",
      defaultService: process.env.RAILWAY_SERVICE_NAME ?? "sollabs-web",
      maxBatchSize: 50,
      flushIntervalMs: 2_000,
    });
    transports.push((entry) => lokiTransport.enqueue(entry));
  }

  return (entry: LogEntry) => {
    transports.forEach((transport) => {
      try {
        const result = transport(entry);
        if (result && typeof (result as Promise<void>).catch === "function") {
          (result as Promise<void>).catch(() => {});
        }
      } catch {}
    });
  };
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
