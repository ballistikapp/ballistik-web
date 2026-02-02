import { router, protectedProcedure } from "../trpc";
import { transactionService } from "@/server/services/transaction.service";
import {
  listTransactionsByTokenSchema,
  liveTransactionsByTokenSchema,
  refreshTransactionsByTokenSchema,
} from "@/server/schemas/transaction.schema";

export const transactionRouter = router({
  listByToken: protectedProcedure
    .input(listTransactionsByTokenSchema)
    .query(async ({ input, ctx }) => {
      return await transactionService.listByToken(input, ctx.user.id);
    }),
  refreshByToken: protectedProcedure
    .input(refreshTransactionsByTokenSchema)
    .mutation(async ({ input, ctx }) => {
      return await transactionService.refreshByToken(input, ctx.user.id);
    }),
  liveByToken: protectedProcedure
    .input(liveTransactionsByTokenSchema)
    .query(async ({ input, ctx }) => {
      return await transactionService.liveByToken(input, ctx.user.id);
    }),
});
