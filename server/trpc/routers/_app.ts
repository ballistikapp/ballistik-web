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
import { subscriptionRouter } from "./subscription.router";
import { dashboardRouter } from "./dashboard.router";

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
  subscription: subscriptionRouter,
  dashboard: dashboardRouter,
});

export type AppRouter = typeof appRouter;
