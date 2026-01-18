import { type FetchCreateContextFnOptions } from "@trpc/server/adapters/fetch";
import { cookies } from "next/headers";
import { verifyToken } from "@/lib/auth/jwt";
import { authService } from "@/server/services";
import { logger } from "@/lib/logger";
import { randomUUID } from "crypto";

export async function createContext(opts?: FetchCreateContextFnOptions) {
  const cookieStore = await cookies();
  const token = cookieStore.get("auth-token")?.value;

  let user = null;
  if (token) {
    const payload = verifyToken(token);
    if (payload) {
      user = await authService.getUserById(payload.userId);
    }
  }

  const requestId =
    opts?.req.headers.get("x-request-id") ?? randomUUID();
  const requestLogger = logger.child({
    requestId,
    ...(user?.id ? { userId: user.id } : {}),
  });

  return {
    user,
    headers: opts?.req.headers,
    requestId,
    logger: requestLogger,
  };
}

export type Context = Awaited<ReturnType<typeof createContext>>;
