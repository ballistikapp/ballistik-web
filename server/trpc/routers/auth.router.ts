import { router, publicProcedure } from "../trpc";
import { authService } from "@/server/services";
import {
  registerSchema,
  loginWithPrivateKeySchema,
} from "@/server/schemas";
import { signToken } from "@/lib/auth/jwt";
import { cookies } from "next/headers";

export const authRouter = router({
  register: publicProcedure
    .input(registerSchema)
    .mutation(async ({ input }) => {
      const user = await authService.register(input);
      
      const token = signToken(user.id, user.mainWalletPublicKey, user.name);
      
      const cookieStore = await cookies();
      cookieStore.set("auth-token", token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
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
      cookieStore.set("auth-token", token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
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

