/**
 * Simple logging utility
 * Currently logs to console, can be extended to write to external services
 */

type LogLevel = "info" | "warn" | "error" | "debug";

interface LogContext {
  [key: string]: unknown;
}

class Logger {
  private log(level: LogLevel, message: string, context?: LogContext) {
    const timestamp = new Date().toISOString();
    const logData = {
      timestamp,
      level,
      message,
      ...context,
    };

    // Current implementation: console logging
    // TODO: Add external logging service (e.g., Sentry, LogRocket, etc.)
    switch (level) {
      case "error":
        console.error(`[${timestamp}] ERROR:`, message, context || "");
        break;
      case "warn":
        console.warn(`[${timestamp}] WARN:`, message, context || "");
        break;
      case "info":
        console.info(`[${timestamp}] INFO:`, message, context || "");
        break;
      case "debug":
        if (process.env.NODE_ENV === "development") {
          console.debug(`[${timestamp}] DEBUG:`, message, context || "");
        }
        break;
    }

    return logData;
  }

  error(message: string, context?: LogContext) {
    return this.log("error", message, context);
  }

  warn(message: string, context?: LogContext) {
    return this.log("warn", message, context);
  }

  info(message: string, context?: LogContext) {
    return this.log("info", message, context);
  }

  debug(message: string, context?: LogContext) {
    return this.log("debug", message, context);
  }
}

export const logger = new Logger();
