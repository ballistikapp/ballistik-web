import { router, protectedProcedure } from "../trpc";
import { holdingService } from "@/server/services/holding.service";
import {
  listHoldingsByTokenSchema,
  refreshHoldingsByTokenSchema,
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
});
