import { router } from "../trpc";
import { testRouter } from "./test.router";

/**
 * Main app router - combines all sub-routers
 * Add new routers here as you create them
 */
export const appRouter = router({
  test: testRouter,
  // Add more routers here:
  // project: projectRouter,
  // wallet: walletRouter,
  // token: tokenRouter,
});

export type AppRouter = typeof appRouter;
