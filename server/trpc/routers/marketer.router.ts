import { protectedRateLimitedProcedure, router } from "../trpc";
import {
  marketerUpdateSetupSchema,
  submitMarketerApplicationSchema,
} from "@/server/schemas";
import {
  marketerApplicationService,
  marketerService,
} from "@/server/services";

export const marketerRouter = router({
  getMe: protectedRateLimitedProcedure.query(async ({ ctx }) => {
    return await marketerService.getMe(ctx.user.id);
  }),
  submitApplication: protectedRateLimitedProcedure
    .input(submitMarketerApplicationSchema)
    .mutation(async ({ input, ctx }) => {
      return await marketerApplicationService.submitApplication(
        ctx.user.id,
        input
      );
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
