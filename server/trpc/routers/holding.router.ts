import {
  expensiveProtectedProcedure,
  protectedRateLimitedProcedure,
  router,
  sensitiveProcedure,
} from "../trpc";
import { holdingService } from "@/server/services/holding.service";
import { holdingExitService } from "@/server/services/holding-exit.service";
import {
  activeExitSchema,
  buyHoldingsByTokenSchema,
  cancelExitSchema,
  exitStatusSchema,
  listHoldingsByTokenSchema,
  monitoringRefreshHoldingsByTokenSchema,
  refreshHoldingsByTokenSchema,
  sellHoldingsByTokenSchema,
  startExitSchema,
} from "@/server/schemas/holding.schema";

export const holdingRouter = router({
  listByToken: protectedRateLimitedProcedure
    .input(listHoldingsByTokenSchema)
    .query(async ({ input, ctx }) => {
      return await holdingService.listByToken(input, ctx.user.id);
    }),
  refreshByToken: expensiveProtectedProcedure
    .input(refreshHoldingsByTokenSchema)
    .mutation(async ({ input, ctx }) => {
      return await holdingService.refreshByToken(input, ctx.user.id);
    }),
  monitoringRefreshByToken: protectedRateLimitedProcedure
    .input(monitoringRefreshHoldingsByTokenSchema)
    .mutation(async ({ input, ctx }) => {
      return await holdingService.monitoringRefreshByToken(
        { tokenPublicKey: input.tokenPublicKey, force: input.force },
        ctx.user.id
      );
    }),
  sellByToken: sensitiveProcedure
    .input(sellHoldingsByTokenSchema)
    .mutation(async ({ input, ctx }) => {
      return await holdingService.sellByToken(input, ctx.user.id);
    }),
  buyByToken: sensitiveProcedure
    .input(buyHoldingsByTokenSchema)
    .mutation(async ({ input, ctx }) => {
      return await holdingService.buyByToken(input, ctx.user.id);
    }),
  startExit: expensiveProtectedProcedure
    .input(startExitSchema)
    .mutation(async ({ input, ctx }) => {
      return await holdingExitService.startExit(input, ctx.user);
    }),
  exitStatus: protectedRateLimitedProcedure
    .input(exitStatusSchema)
    .query(async ({ input, ctx }) => {
      return await holdingExitService.getExitStatus(input, ctx.user.id);
    }),
  getActiveExit: protectedRateLimitedProcedure
    .input(activeExitSchema)
    .query(async ({ input, ctx }) => {
      return await holdingExitService.getActiveExit(input, ctx.user.id);
    }),
  cancelExit: expensiveProtectedProcedure
    .input(cancelExitSchema)
    .mutation(async ({ input, ctx }) => {
      return await holdingExitService.cancelExit(input, ctx.user.id);
    }),
});
