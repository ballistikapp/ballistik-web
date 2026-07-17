import { initTRPC, TRPCError, type TRPC_ERROR_CODE_KEY } from "@trpc/server";
import { type Context } from "./context";
import superjson from "superjson";
import { ZodError } from "zod";
import { isAppError } from "@/server/errors";
import { logger } from "@/lib/logger";
import { ensureRateLimit, type RateLimitTier } from "@/server/security/api-abuse";

/**
 * Initialize tRPC with context
 */
const t = initTRPC.context<Context>().create({
  transformer: superjson,
  errorFormatter({ shape, error }) {
    // If it's our custom AppError, show the message to the user
    if (error.cause && isAppError(error.cause)) {
      return {
        ...shape,
        message: error.cause.message, // Show custom message
        data: {
          ...shape.data,
          statusCode: error.cause.statusCode,
        },
      };
    }

    // If it's a Zod validation error, format it nicely
    if (error.cause instanceof ZodError) {
      const firstError = error.cause.errors[0];
      return {
        ...shape,
        message: firstError?.message || "Validation failed",
        data: {
          ...shape.data,
          zodError: error.cause.flatten(),
        },
      };
    }

    // For any other error, show generic message
    // (Don't expose internal errors to users)
    return {
      ...shape,
      message: "Something went wrong",
      data: {
        ...shape.data,
      },
    };
  },
});

/**
 * Export reusable router and procedure helpers
 */
export const router = t.router;
export const publicProcedure = t.procedure;

const errorMapperMiddleware = t.middleware(async ({ next, ctx, path }) => {
  try {
    return await next();
  } catch (error) {
    if (isAppError(error)) {
      const codeMap: Record<number, TRPC_ERROR_CODE_KEY> = {
        400: "BAD_REQUEST",
        401: "UNAUTHORIZED",
        403: "FORBIDDEN",
        404: "NOT_FOUND",
        429: "TOO_MANY_REQUESTS",
        409: "CONFLICT",
        500: "INTERNAL_SERVER_ERROR",
      };
      throw new TRPCError({
        code: codeMap[error.statusCode] || "INTERNAL_SERVER_ERROR",
        message: error.message,
        cause: error,
      });
    }
    if (error instanceof TRPCError) {
      throw error;
    }
    const errorContext =
      error instanceof Error
        ? { errorName: error.name, errorMessage: error.message }
        : { errorName: "UnknownError", errorMessage: String(error) };
    const requestLogger = ctx?.logger ?? logger;
    requestLogger.error("Unhandled tRPC error", {
      path,
      ...errorContext,
    });
    throw error;
  }
});

const rateLimitMiddleware = (tier: RateLimitTier) =>
  t.middleware(async ({ next, ctx, path }) => {
    const actor =
      ctx.user?.id ??
      (ctx.clientIp && ctx.clientIp !== "unknown"
        ? `ip:${ctx.clientIp}`
        : `rid:${ctx.requestId}`);
    const key = `${actor}:${path}`;

    try {
      ensureRateLimit({ tier, key });
    } catch (error) {
      const requestLogger = ctx?.logger ?? logger;
      requestLogger.warn("tRPC rate limit exceeded", {
        path,
        tier,
        actor,
      });
      throw error;
    }

    return await next();
  });

const requireAuthMiddleware = t.middleware(({ ctx, next }) => {
  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }
  return next({
    ctx: {
      ...ctx,
      user: ctx.user,
    },
  });
});

export const protectedProcedure = t.procedure
  .use(requireAuthMiddleware)
  .use(rateLimitMiddleware("protected"))
  .use(errorMapperMiddleware);

export const publicRateLimitedProcedure = t.procedure
  .use(rateLimitMiddleware("public"))
  .use(errorMapperMiddleware);

export const authRateLimitedProcedure = t.procedure
  .use(rateLimitMiddleware("auth"))
  .use(errorMapperMiddleware);

export const protectedRateLimitedProcedure = t.procedure
  .use(requireAuthMiddleware)
  .use(rateLimitMiddleware("protected"))
  .use(errorMapperMiddleware);

export const expensiveProtectedProcedure = t.procedure
  .use(requireAuthMiddleware)
  .use(rateLimitMiddleware("expensiveMutation"))
  .use(errorMapperMiddleware);

export const sensitiveProcedure = t.procedure
  .use(requireAuthMiddleware)
  .use(rateLimitMiddleware("sensitiveMutation"))
  .use(errorMapperMiddleware);

/**
 * Authenticated ops procedures. Operator authorization is enforced in opsService
 * (DB `User.isOperator` check) so denial stays not-found and is testable at the service seam.
 */
export const operatorProcedure = protectedProcedure;
export const operatorSensitiveProcedure = sensitiveProcedure;

/**
 * Middleware example - logging
 */
export const loggedProcedure = t.procedure.use(async ({ path, next, ctx }) => {
  const start = Date.now();
  const result = await next();
  const duration = Date.now() - start;
  const requestLogger = ctx?.logger ?? logger;
  requestLogger.debug("tRPC request", {
    path,
    durationMs: duration,
  });

  return result;
});
