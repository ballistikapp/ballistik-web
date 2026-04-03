import { router, protectedProcedure } from "../trpc";
import { appTransactionService } from "@/server/services/app-transaction.service";
import { listAppTransactionsSchema } from "@/server/schemas/app-transaction.schema";

export const appTransactionRouter = router({
  list: protectedProcedure
    .input(listAppTransactionsSchema)
    .query(async ({ input, ctx }) => {
      return await appTransactionService.list({
        ...input,
        userId: ctx.user.id,
      });
    }),
});
