import { router, protectedProcedure } from "../trpc";
import { walletService } from "@/server/services/wallet.service";
import {
  getWalletByTokenSchema,
  getDevWalletByTokenSchema,
  getMainWalletSchema,
  getOperationalWalletsByTokenSchema,
  refreshWalletBalancesSchema,
  returnSolSchema,
  sendSolSchema,
} from "@/server/schemas/wallet.schema";

export const walletRouter = router({
  getOperationalByToken: protectedProcedure
    .input(getOperationalWalletsByTokenSchema)
    .query(async ({ input, ctx }) => {
      return await walletService.getOperationalWalletsByToken(
        input.tokenPublicKey,
        ctx.user.id
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
  refreshBalances: protectedProcedure
    .input(refreshWalletBalancesSchema)
    .mutation(async ({ input, ctx }) => {
      return await walletService.refreshWalletBalances(
        input.tokenPublicKey,
        ctx.user.id,
        input.walletPublicKeys
      );
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
        input.amountSol
      );
    }),
});
