import { type FetchCreateContextFnOptions } from "@trpc/server/adapters/fetch";
import { cookies } from "next/headers";
import { verifyToken } from "@/lib/auth/jwt";
import { logger } from "@/lib/logger";
import { randomUUID } from "crypto";
import { initVolumeBotTimers } from "@/lib/volume-bot-init";
import type { ContextUser } from "@/server/schemas/auth.schema";

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
        mainWalletPublicKey: payload.publicKey,
      };
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
