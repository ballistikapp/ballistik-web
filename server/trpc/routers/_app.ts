import { router } from "../trpc";
import { testRouter } from "./test.router";
import { authRouter } from "./auth.router";
import { tokenRouter } from "./token.router";
import { walletRouter } from "./wallet.router";

export const appRouter = router({
  test: testRouter,
  auth: authRouter,
  token: tokenRouter,
  wallet: walletRouter,
});

export type AppRouter = typeof appRouter;
