import { router, protectedProcedure } from "../trpc";
import { walletService } from "@/server/services/wallet.service";
import {
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
} from "@/server/schemas/wallet.schema";

export const walletRouter = router({
  getOperationalByToken: protectedProcedure
    .input(getOperationalWalletsByTokenSchema)
    .query(async ({ input, ctx }) => {
      return await walletService.getOperationalWalletsByToken(
        input.tokenPublicKey,
        ctx.user.id,
        { page: input.page, pageSize: input.pageSize }
      );
    }),
  getDevByToken: protectedProcedure
    .input(getDevWalletByTokenSchema)
    .query(async ({ input, ctx }) => {
      return await walletService.getDevWalletByToken(
        input.tokenPublicKey,
        ctx.user.id
      );
    }),
  getMain: protectedProcedure
    .input(getMainWalletSchema)
    .query(async ({ ctx }) => {
      return await walletService.getMainWallet(ctx.user.id);
    }),
  getByPublicKey: protectedProcedure
    .input(getWalletByTokenSchema)
    .query(async ({ input, ctx }) => {
      return await walletService.getWalletByToken(
        input.tokenPublicKey,
        input.walletPublicKey,
        ctx.user.id
      );
    }),
  getPrivateKey: protectedProcedure
    .input(getWalletPrivateKeySchema)
    .mutation(async ({ input, ctx }) => {
      return await walletService.getWalletPrivateKey(
        input.tokenPublicKey,
        input.walletPublicKey,
        ctx.user.id
      );
    }),
  getMainPrivateKey: protectedProcedure
    .input(getMainWalletPrivateKeySchema)
    .mutation(async ({ ctx }) => {
      return await walletService.getMainWalletPrivateKey(ctx.user.id);
    }),
  refreshBalances: protectedProcedure
    .input(refreshWalletBalancesSchema)
    .mutation(async ({ input, ctx }) => {
      return await walletService.refreshWalletBalances(
        input.tokenPublicKey,
        ctx.user.id,
        input.walletPublicKeys,
        input.force
      );
    }),
  refreshMainBalance: protectedProcedure
    .input(refreshMainWalletBalanceSchema)
    .mutation(async ({ ctx }) => {
      return await walletService.refreshMainWalletBalance(ctx.user.id);
    }),
  sendSol: protectedProcedure
    .input(sendSolSchema)
    .mutation(async ({ input, ctx }) => {
      return await walletService.sendSolFromMainWallet(
        input.tokenPublicKey,
        ctx.user.id,
        input.walletPublicKeys,
        input.amountSol
      );
    }),
  returnSol: protectedProcedure
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
});
