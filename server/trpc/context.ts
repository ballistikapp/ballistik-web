import { type FetchCreateContextFnOptions } from "@trpc/server/adapters/fetch";
import { cookies } from "next/headers";
import { verifyToken } from "@/lib/auth/jwt";
import { logger } from "@/lib/logger";
import { randomUUID } from "crypto";
import { initVolumeBotTimers } from "@/lib/volume-bot-init";
import type { ContextUser } from "@/server/schemas/auth.schema";

function resolveClientIp(headers: Headers | undefined): string {
  if (!headers) {
    return "unknown";
  }

  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    const firstIp = forwarded
      .split(",")
      .map((part) => part.trim())
      .find(Boolean);
    if (firstIp) {
      return firstIp;
    }
  }

  const realIp = headers.get("x-real-ip");
  if (realIp) {
    return realIp.trim();
  }

  return "unknown";
}

export async function createContext(opts?: FetchCreateContextFnOptions) {
  void initVolumeBotTimers().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    logger.error("Volume bot timer init failed", { errorMessage: message });
  });

  const cookieStore = await cookies();
  const token = cookieStore.get("auth-token")?.value;

  let user: ContextUser | null = null;
  if (token) {
    const payload = verifyToken(token);
    if (payload) {
      user = {
        id: payload.userId,
        name: payload.name ?? "User",
        plan: payload.plan,
        mainWalletPublicKey: payload.publicKey,
        authWalletPublicKey: payload.authWalletPublicKey ?? null,
      };
    }
  }

  const requestId =
    opts?.req.headers.get("x-request-id") ?? randomUUID();
  const clientIp = resolveClientIp(opts?.req.headers);
  const userAgent = opts?.req.headers.get("user-agent") ?? "unknown";
  const requestLogger = logger.child({
    requestId,
    clientIp,
    userAgent,
    ...(user?.id ? { userId: user.id } : {}),
  });

  return {
    user,
    headers: opts?.req.headers,
    requestId,
    clientIp,
    userAgent,
    logger: requestLogger,
  };
}

export type Context = Awaited<ReturnType<typeof createContext>>;
