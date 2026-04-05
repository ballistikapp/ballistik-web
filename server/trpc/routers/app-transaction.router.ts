import { router, protectedProcedure } from "../trpc";
import { appTransactionService } from "@/server/services/app-transaction.service";
import {
  listAppTransactionsSchema,
  costBreakdownSchema,
} from "@/server/schemas/app-transaction.schema";

export const appTransactionRouter = router({
  list: protectedProcedure
    .input(listAppTransactionsSchema)
    .query(async ({ input, ctx }) => {
      return await appTransactionService.list({
        ...input,
        userId: ctx.user.id,
      });
    }),

  costBreakdown: protectedProcedure
    .input(costBreakdownSchema)
    .query(async ({ input, ctx }) => {
      return await appTransactionService.costBreakdown(
        ctx.user.id,
        input.tokenPublicKey
      );
    }),
});
