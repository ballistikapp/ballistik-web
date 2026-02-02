import { router, publicProcedure } from "../trpc";
import { authService } from "@/server/services";
import { registerSchema, loginWithPrivateKeySchema } from "@/server/schemas";
import { signToken } from "@/lib/auth/jwt";
import { cookies, headers } from "next/headers";

const privateIpPattern = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[0-1])\.)/;

async function resolveCookieSecure() {
  if (process.env.NODE_ENV !== "production") {
    return false;
  }
  const headerStore = await headers();
  const host = headerStore.get("host") ?? "";
  const hostname = host.split(":")[0]?.toLowerCase();
  if (!hostname) {
    return true;
  }
  const isLocalhost =
    hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
  const isPrivateIp = privateIpPattern.test(hostname);
  const isLocalDomain = hostname.endsWith(".local");
  return !(isLocalhost || isPrivateIp || isLocalDomain);
}

export const authRouter = router({
  register: publicProcedure
    .input(registerSchema)
    .mutation(async ({ input }) => {
      const user = await authService.register(input);

      const token = signToken(user.id, user.mainWalletPublicKey, user.name);

      const cookieStore = await cookies();
      const secureCookie = await resolveCookieSecure();
      cookieStore.set("auth-token", token, {
        httpOnly: true,
        secure: secureCookie,
        sameSite: "lax",
        maxAge: 31536000,
        path: "/",
      });

      return {
        success: true,
        user,
      };
    }),

  loginWithPrivateKey: publicProcedure
    .input(loginWithPrivateKeySchema)
    .mutation(async ({ input }) => {
      const user = await authService.loginWithPrivateKey(input);

      const token = signToken(user.id, user.mainWalletPublicKey, user.name);

      const cookieStore = await cookies();
      const secureCookie = await resolveCookieSecure();
      cookieStore.set("auth-token", token, {
        httpOnly: true,
        secure: secureCookie,
        sameSite: "lax",
        maxAge: 31536000,
        path: "/",
      });

      return {
        success: true,
        user,
      };
    }),

  logout: publicProcedure.mutation(async () => {
    const cookieStore = await cookies();
    cookieStore.delete("auth-token");

    return {
      success: true,
    };
  }),

  me: publicProcedure.query(async ({ ctx }) => {
    if (!ctx.user) {
      return null;
    }

    return ctx.user;
  }),
});
