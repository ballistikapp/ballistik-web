import {
  expensiveProtectedProcedure,
  protectedRateLimitedProcedure,
  router,
  sensitiveProcedure,
} from "../trpc";
import { walletService } from "@/server/services/wallet.service";
import {
  createBuyerWalletsByTokenSchema,
  getWalletByTokenSchema,
  getDevWalletByTokenSchema,
  getMainWalletSchema,
  getMainWalletPrivateKeySchema,
  getOperationalWalletsByTokenSchema,
  getWalletPrivateKeySchema,
  refreshWalletBalancesSchema,
  refreshMainWalletBalanceSchema,
  returnSolSchema,
  sendSolSchema,
  withdrawMainSolSchema,
} from "@/server/schemas/wallet.schema";

export const walletRouter = router({
  createBuyerByToken: sensitiveProcedure
    .input(createBuyerWalletsByTokenSchema)
    .mutation(async ({ input, ctx }) => {
      return await walletService.createBuyerWalletsByToken(
        input,
        ctx.user.id,
        { plan: ctx.user.plan }
      );
    }),
  getOperationalByToken: protectedRateLimitedProcedure
    .input(getOperationalWalletsByTokenSchema)
    .query(async ({ input, ctx }) => {
      return await walletService.getOperationalWalletsByToken(
        input.tokenPublicKey,
        ctx.user.id,
        { page: input.page, pageSize: input.pageSize }
      );
    }),
  getDevByToken: protectedRateLimitedProcedure
    .input(getDevWalletByTokenSchema)
    .query(async ({ input, ctx }) => {
      return await walletService.getDevWalletByToken(
        input.tokenPublicKey,
        ctx.user.id
      );
    }),
  getMain: protectedRateLimitedProcedure
    .input(getMainWalletSchema)
    .query(async ({ ctx }) => {
      return await walletService.getMainWallet(ctx.user.id);
    }),
  getByPublicKey: protectedRateLimitedProcedure
    .input(getWalletByTokenSchema)
    .query(async ({ input, ctx }) => {
      return await walletService.getWalletByToken(
        input.tokenPublicKey,
        input.walletPublicKey,
        ctx.user.id
      );
    }),
  getPrivateKey: sensitiveProcedure
    .input(getWalletPrivateKeySchema)
    .mutation(async ({ input, ctx }) => {
      return await walletService.getWalletPrivateKey(
        input.tokenPublicKey,
        input.walletPublicKey,
        ctx.user.id
      );
    }),
  getMainPrivateKey: sensitiveProcedure
    .input(getMainWalletPrivateKeySchema)
    .mutation(async ({ ctx }) => {
      return await walletService.getMainWalletPrivateKey(ctx.user.id);
    }),
  refreshBalances: expensiveProtectedProcedure
    .input(refreshWalletBalancesSchema)
    .mutation(async ({ input, ctx }) => {
      return await walletService.refreshWalletBalances(
        input.tokenPublicKey,
        ctx.user.id,
        input.walletPublicKeys,
        input.force
      );
    }),
  refreshMainBalance: expensiveProtectedProcedure
    .input(refreshMainWalletBalanceSchema)
    .mutation(async ({ ctx }) => {
      return await walletService.refreshMainWalletBalance(ctx.user.id);
    }),
  sendSol: sensitiveProcedure
    .input(sendSolSchema)
    .mutation(async ({ input, ctx }) => {
      return await walletService.sendSolFromMainWallet(
        input.tokenPublicKey,
        ctx.user.id,
        input.walletPublicKeys,
        input.amountSol
      );
    }),
  returnSol: sensitiveProcedure
    .input(returnSolSchema)
    .mutation(async ({ input, ctx }) => {
      return await walletService.returnSolToMainWallet(
        input.tokenPublicKey,
        ctx.user.id,
        input.walletPublicKeys,
        input.amountSol,
        input.useMax
      );
    }),
  withdrawMainSol: sensitiveProcedure
    .input(withdrawMainSolSchema)
    .mutation(async ({ input, ctx }) => {
      return await walletService.withdrawMainSol(
        ctx.user.id,
        input.destinationPublicKey,
        input.amountSol,
        input.useMax
      );
    }),
});
