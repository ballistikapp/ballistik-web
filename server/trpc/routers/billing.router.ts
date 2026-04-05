import {
  expensiveProtectedProcedure,
  protectedRateLimitedProcedure,
  router,
} from "../trpc";
import {
  billingHistorySchema,
  billingOverviewSchema,
  purchaseSubscriptionSchema,
} from "@/server/schemas";
import { subscriptionService } from "@/server/services/pro-subscription.service";

export const billingRouter = router({
  getSubscriptionOverview: protectedRateLimitedProcedure
    .input(billingOverviewSchema)
    .query(async ({ ctx }) => {
      return await subscriptionService.getSubscriptionOverview(
        ctx.user.id,
        ctx.user.plan
      );
    }),
  getHistory: protectedRateLimitedProcedure
    .input(billingHistorySchema)
    .query(async ({ input, ctx }) => {
      return await subscriptionService.listHistory(ctx.user.id, input.limit);
    }),
  purchaseSubscription: expensiveProtectedProcedure
    .input(purchaseSubscriptionSchema)
    .mutation(async ({ input, ctx }) => {
      return await subscriptionService.purchaseSubscription(
        ctx.user.id,
        input.plan
      );
    }),
});
