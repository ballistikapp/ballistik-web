import { type FetchCreateContextFnOptions } from "@trpc/server/adapters/fetch";
import { cookies } from "next/headers";
import { verifyToken } from "@/lib/auth/jwt";
import { authService } from "@/server/services";

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

  return {
    user,
    headers: opts?.req.headers,
  };
}

export type Context = Awaited<ReturnType<typeof createContext>>;
