import { protectedRateLimitedProcedure, router } from "../trpc";
import { marketerUpdateSetupSchema } from "@/server/schemas";
import { marketerService } from "@/server/services";

export const marketerRouter = router({
  getMe: protectedRateLimitedProcedure.query(async ({ ctx }) => {
    return await marketerService.getMe(ctx.user.id);
  }),
  updateSetup: protectedRateLimitedProcedure
    .input(marketerUpdateSetupSchema)
    .mutation(async ({ input, ctx }) => {
      return await marketerService.updateSetup(ctx.user.id, input);
    }),
  listReferredUsers: protectedRateLimitedProcedure.query(async ({ ctx }) => {
    return await marketerService.listReferredUsers(ctx.user.id);
  }),
  listPayouts: protectedRateLimitedProcedure.query(async ({ ctx }) => {
    return await marketerService.listPayouts(ctx.user.id);
  }),
  getAggregates: protectedRateLimitedProcedure.query(async ({ ctx }) => {
    return await marketerService.getAggregates(ctx.user.id);
  }),
});
