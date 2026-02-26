import { router, protectedProcedure } from "../trpc";
import { launchService } from "@/server/services/launch.service";
import {
  launchRecoverSolByTokenSchema,
  launchRecoverySchema,
  launchRecoveryByTokenSchema,
  launchRecoverSolSchema,
  launchTokenSchema,
  launchStatusSchema,
} from "@/server/schemas/launch.schema";

export const launchRouter = router({
  start: protectedProcedure.input(launchTokenSchema).mutation(async ({ input, ctx }) => {
    return await launchService.startLaunch(input, ctx.user.id);
  }),
  status: protectedProcedure.input(launchStatusSchema).query(async ({ input, ctx }) => {
    return await launchService.getLaunchStatus(input.launchId, ctx.user.id);
  }),
  cancel: protectedProcedure.input(launchStatusSchema).mutation(async ({ input, ctx }) => {
    return await launchService.cancelLaunch(input.launchId, ctx.user.id);
  }),
  getActive: protectedProcedure.query(async ({ ctx }) => {
    return await launchService.getActiveLaunch(ctx.user.id);
  }),
  getFailedLaunches: protectedProcedure.query(async ({ ctx }) => {
    return await launchService.getFailedLaunches(ctx.user.id);
  }),
  recoveryWallets: protectedProcedure
    .input(launchRecoverySchema)
    .query(async ({ input, ctx }) => {
      return await launchService.getRecoveryWallets(input.launchId, ctx.user.id);
    }),
  recoveryWalletsByToken: protectedProcedure
    .input(launchRecoveryByTokenSchema)
    .query(async ({ input, ctx }) => {
      return await launchService.getRecoveryWalletsByToken(
        input.tokenPublicKey,
        ctx.user.id
      );
    }),
  recoverSol: protectedProcedure
    .input(launchRecoverSolSchema)
    .mutation(async ({ input, ctx }) => {
      return await launchService.recoverSol(
        input.launchId,
        ctx.user.id,
        input.walletPublicKeys
      );
    }),
  recoverSolByToken: protectedProcedure
    .input(launchRecoverSolByTokenSchema)
    .mutation(async ({ input, ctx }) => {
      return await launchService.recoverSolByToken(
        input.tokenPublicKey,
        ctx.user.id,
        input.walletPublicKeys
      );
    }),
});
