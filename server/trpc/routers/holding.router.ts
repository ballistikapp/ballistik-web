import { router, protectedProcedure } from "../trpc";
import { holdingService } from "@/server/services/holding.service";
import { holdingExitService } from "@/server/services/holding-exit.service";
import {
  activeExitSchema,
  cancelExitSchema,
  exitStatusSchema,
  listHoldingsByTokenSchema,
  refreshHoldingsByTokenSchema,
  sellHoldingsByTokenSchema,
  startExitSchema,
} from "@/server/schemas/holding.schema";

export const holdingRouter = router({
  listByToken: protectedProcedure
    .input(listHoldingsByTokenSchema)
    .query(async ({ input, ctx }) => {
      return await holdingService.listByToken(input, ctx.user.id);
    }),
  refreshByToken: protectedProcedure
    .input(refreshHoldingsByTokenSchema)
    .mutation(async ({ input, ctx }) => {
      return await holdingService.refreshByToken(input, ctx.user.id);
    }),
  sellByToken: protectedProcedure
    .input(sellHoldingsByTokenSchema)
    .mutation(async ({ input, ctx }) => {
      return await holdingService.sellByToken(input, ctx.user.id);
    }),
  startExit: protectedProcedure
    .input(startExitSchema)
    .mutation(async ({ input, ctx }) => {
      return await holdingExitService.startExit(input, ctx.user.id);
    }),
  exitStatus: protectedProcedure
    .input(exitStatusSchema)
    .query(async ({ input, ctx }) => {
      return await holdingExitService.getExitStatus(input, ctx.user.id);
    }),
  getActiveExit: protectedProcedure
    .input(activeExitSchema)
    .query(async ({ input, ctx }) => {
      return await holdingExitService.getActiveExit(input, ctx.user.id);
    }),
  cancelExit: protectedProcedure
    .input(cancelExitSchema)
    .mutation(async ({ input, ctx }) => {
      return await holdingExitService.cancelExit(input, ctx.user.id);
    }),
});
