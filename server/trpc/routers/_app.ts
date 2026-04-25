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
import { testRunLogRouter } from "./test-run-log.router";
import { billingRouter } from "./billing.router";
import { appTransactionRouter } from "./app-transaction.router";
import { creatorRewardRouter } from "./creator-rewards.router";
import { activeProcessRouter } from "./active-process.router";

const baseRouters = {
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
  billing: billingRouter,
  appTransaction: appTransactionRouter,
  creatorReward: creatorRewardRouter,
  activeProcess: activeProcessRouter,
  testRunLog: testRunLogRouter,
};

export const appRouter =
  process.env.NODE_ENV === "production"
    ? router(baseRouters)
    : router({
        test: testRouter,
        ...baseRouters,
      });

export type AppRouter = typeof appRouter;
