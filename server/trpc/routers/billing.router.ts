import {
  expensiveProtectedProcedure,
  protectedRateLimitedProcedure,
  router,
} from "../trpc";
import {
  billingHistorySchema,
  billingOverviewSchema,
  purchaseWeeklyProSchema,
} from "@/server/schemas";
import { proSubscriptionService } from "@/server/services/pro-subscription.service";

export const billingRouter = router({
  getSubscriptionOverview: protectedRateLimitedProcedure
    .input(billingOverviewSchema)
    .query(async ({ ctx }) => {
      return await proSubscriptionService.getSubscriptionOverview(
        ctx.user.id,
        ctx.user.plan
      );
    }),
  getHistory: protectedRateLimitedProcedure
    .input(billingHistorySchema)
    .query(async ({ input, ctx }) => {
      return await proSubscriptionService.listHistory(ctx.user.id, input.limit);
    }),
  purchaseWeeklyPro: expensiveProtectedProcedure
    .input(purchaseWeeklyProSchema)
    .mutation(async ({ ctx }) => {
      return await proSubscriptionService.purchaseWeeklyPro(ctx.user.id);
    }),
});
