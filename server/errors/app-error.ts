import { logger } from "@/lib/logger";

/**
 * Custom application error
 * Throw this when you want to show a specific message to the user
 * Any other error will show "Something went wrong"
 */
export class AppError extends Error {
  public readonly statusCode: number;
  public readonly context?: Record<string, unknown>;

  constructor(
    message: string,
    statusCode: number = 400,
    context?: Record<string, unknown>
  ) {
    super(message);
    this.name = "AppError";
    this.statusCode = statusCode;
    this.context = context;

    // Log the error automatically
    logger.error(message, {
      errorName: "AppError",
      statusCode,
      ...context,
    });

    // Maintains proper stack trace for where our error was thrown
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, AppError);
    }
  }
}

/**
 * Check if an error is an AppError
 */
export function isAppError(error: unknown): error is AppError {
  if (error instanceof AppError) {
    return true;
  }
  if (!error || typeof error !== "object") {
    return false;
  }
  const candidate = error as {
    name?: string;
    statusCode?: number;
    message?: string;
  };
  return (
    candidate.name === "AppError" &&
    typeof candidate.statusCode === "number" &&
    typeof candidate.message === "string"
  );
}
