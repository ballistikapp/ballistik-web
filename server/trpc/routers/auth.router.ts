import {
  authRateLimitedProcedure,
  protectedRateLimitedProcedure,
  publicRateLimitedProcedure,
  router,
} from "../trpc";
import { authService } from "@/server/services";
import {
  registerSchema,
  loginWithPrivateKeySchema,
  refreshSessionSchema,
  updateNameSchema,
} from "@/server/schemas";
import { signToken } from "@/lib/auth/jwt";
import { cookies, headers } from "next/headers";
import { getAccessTokenMaxAgeSeconds } from "@/lib/auth/jwt";
import { getRefreshTokenTtlDays } from "@/lib/auth/refresh-token";
import { AppError } from "@/server/errors";

const privateIpPattern = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[0-1])\.)/;
const ACCESS_TOKEN_COOKIE = "auth-token";
const REFRESH_TOKEN_COOKIE = "refresh-token";

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

function getRefreshTokenMaxAgeSeconds() {
  return getRefreshTokenTtlDays() * 24 * 60 * 60;
}

async function setSessionCookies(accessToken: string, refreshToken: string) {
  const cookieStore = await cookies();
  const secureCookie = await resolveCookieSecure();
  cookieStore.set(ACCESS_TOKEN_COOKIE, accessToken, {
    httpOnly: true,
    secure: secureCookie,
    sameSite: "lax",
    maxAge: getAccessTokenMaxAgeSeconds(),
    path: "/",
  });
  cookieStore.set(REFRESH_TOKEN_COOKIE, refreshToken, {
    httpOnly: true,
    secure: secureCookie,
    sameSite: "lax",
    maxAge: getRefreshTokenMaxAgeSeconds(),
    path: "/",
  });
}

async function clearSessionCookies() {
  const cookieStore = await cookies();
  cookieStore.delete(ACCESS_TOKEN_COOKIE);
  cookieStore.delete(REFRESH_TOKEN_COOKIE);
}

export const authRouter = router({
  register: authRateLimitedProcedure
    .input(registerSchema)
    .mutation(async ({ input, ctx }) => {
      let user;
      try {
        user = await authService.register(input);
      } catch (error) {
        ctx.logger.warn("Auth register failed", {
          clientIp: ctx.clientIp,
          errorMessage: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }

      const session = await authService.createSession(user, {
        clientIp: ctx.clientIp,
        userAgent: ctx.userAgent,
      });
      await setSessionCookies(session.accessToken, session.refreshToken);

      return {
        success: true,
        user,
      };
    }),

  loginWithPrivateKey: authRateLimitedProcedure
    .input(loginWithPrivateKeySchema)
    .mutation(async ({ input, ctx }) => {
      let user;
      try {
        user = await authService.loginWithPrivateKey(input);
      } catch (error) {
        ctx.logger.warn("Auth login failed", {
          clientIp: ctx.clientIp,
          errorMessage: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }

      const session = await authService.createSession(user, {
        clientIp: ctx.clientIp,
        userAgent: ctx.userAgent,
      });
      await setSessionCookies(session.accessToken, session.refreshToken);

      return {
        success: true,
        user,
      };
    }),

  logout: authRateLimitedProcedure.mutation(async () => {
    const cookieStore = await cookies();
    const refreshToken = cookieStore.get(REFRESH_TOKEN_COOKIE)?.value;
    if (refreshToken) {
      await authService.revokeSessionByRefreshToken(refreshToken);
    }
    await clearSessionCookies();

    return {
      success: true,
    };
  }),

  refreshSession: authRateLimitedProcedure
    .input(refreshSessionSchema)
    .mutation(async ({ ctx }) => {
      const cookieStore = await cookies();
      const refreshToken = cookieStore.get(REFRESH_TOKEN_COOKIE)?.value;
      if (!refreshToken) {
        throw new AppError("Refresh token missing", 401);
      }

      const refreshed = await authService.refreshSession(refreshToken, {
        clientIp: ctx.clientIp,
        userAgent: ctx.userAgent,
      });
      await setSessionCookies(refreshed.accessToken, refreshed.refreshToken);

      return {
        success: true,
        sessionId: refreshed.sessionId,
      };
    }),

  me: publicRateLimitedProcedure.query(async ({ ctx }) => {
    if (!ctx.user) {
      return null;
    }

    return ctx.user;
  }),

  updateName: protectedRateLimitedProcedure
    .input(updateNameSchema)
    .mutation(async ({ input, ctx }) => {
      const updated = await authService.updateName(ctx.user.id, input);

      const token = signToken(
        updated.id,
        updated.mainWalletPublicKey,
        updated.name,
        updated.plan
      );
      const cookieStore = await cookies();
      const secureCookie = await resolveCookieSecure();
      cookieStore.set(ACCESS_TOKEN_COOKIE, token, {
        httpOnly: true,
        secure: secureCookie,
        sameSite: "lax",
        maxAge: getAccessTokenMaxAgeSeconds(),
        path: "/",
      });

      return updated;
    }),

  logoutAll: protectedRateLimitedProcedure.mutation(async ({ ctx }) => {
    await authService.revokeAllSessions(ctx.user.id);
    await clearSessionCookies();
    return { success: true };
  }),
});
