import { router } from "../trpc";
import { testRouter } from "./test.router";
import { authRouter } from "./auth.router";
import { tokenRouter } from "./token.router";
import { walletRouter } from "./wallet.router";
import { launchRouter } from "./launch.router";
import { holdingRouter } from "./holding.router";
import { transactionRouter } from "./transaction.router";
import { refreshCacheRouter } from "./refresh-cache.router";
import { volumeBotRouter } from "./volume-bot.router";

export const appRouter = router({
  test: testRouter,
  auth: authRouter,
  token: tokenRouter,
  wallet: walletRouter,
  launch: launchRouter,
  holding: holdingRouter,
  transaction: transactionRouter,
  refreshCache: refreshCacheRouter,
  volumeBot: volumeBotRouter,
});

export type AppRouter = typeof appRouter;
