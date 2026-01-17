import { initTRPC, TRPCError, type TRPC_ERROR_CODE_KEY } from "@trpc/server";
import { type Context } from "./context";
import superjson from "superjson";
import { ZodError } from "zod";
import { isAppError } from "@/server/errors";

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

const errorMapperMiddleware = t.middleware(async ({ next }) => {
  try {
    return await next();
  } catch (error) {
    if (isAppError(error)) {
      const codeMap: Record<number, TRPC_ERROR_CODE_KEY> = {
        400: "BAD_REQUEST",
        401: "UNAUTHORIZED",
        403: "FORBIDDEN",
        404: "NOT_FOUND",
        409: "CONFLICT",
        500: "INTERNAL_SERVER_ERROR",
      };
      throw new TRPCError({
        code: codeMap[error.statusCode] || "INTERNAL_SERVER_ERROR",
        message: error.message,
        cause: error,
      });
    }
    throw error;
  }
});

export const protectedProcedure = t.procedure
  .use(({ ctx, next }) => {
    if (!ctx.user) {
      throw new TRPCError({ code: "UNAUTHORIZED" });
    }
    return next({
      ctx: {
        user: ctx.user,
      },
    });
  })
  .use(errorMapperMiddleware);

/**
 * Middleware example - logging
 */
export const loggedProcedure = t.procedure.use(async ({ path, next }) => {
  const start = Date.now();
  const result = await next();
  const duration = Date.now() - start;

  if (process.env.NODE_ENV === "development") {
    console.log(`[tRPC] ${path} took ${duration}ms`);
  }

  return result;
});
