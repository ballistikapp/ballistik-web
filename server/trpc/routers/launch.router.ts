import {
  expensiveProtectedProcedure,
  protectedRateLimitedProcedure,
  router,
  sensitiveProcedure,
} from "../trpc";
import { launchService } from "@/server/services/launch.service";
import {
  launchPreviewCostsSchema,
  launchRecoverSolByTokenSchema,
  launchRecoverySchema,
  launchRecoveryByTokenSchema,
  launchRetrySchema,
  launchRecoverSolSchema,
  launchTokenSchema,
  launchStatusSchema,
} from "@/server/schemas/launch.schema";

export const launchRouter = router({
  previewCosts: protectedRateLimitedProcedure
    .input(launchPreviewCostsSchema)
    .query(async ({ input, ctx }) => {
      return await launchService.previewCosts(input, ctx.user.id);
    }),
  start: expensiveProtectedProcedure.input(launchTokenSchema).mutation(async ({ input, ctx }) => {
    return await launchService.startLaunch(input, ctx.user.id);
  }),
  status: protectedRateLimitedProcedure.input(launchStatusSchema).query(async ({ input, ctx }) => {
    return await launchService.getLaunchStatus(input.launchId, ctx.user.id);
  }),
  cancel: expensiveProtectedProcedure.input(launchStatusSchema).mutation(async ({ input, ctx }) => {
    return await launchService.cancelLaunch(input.launchId, ctx.user.id);
  }),
  retry: expensiveProtectedProcedure.input(launchRetrySchema).mutation(async ({ input, ctx }) => {
    return await launchService.retryLaunch(input.launchId, ctx.user.id);
  }),
  getActive: protectedRateLimitedProcedure.query(async ({ ctx }) => {
    return await launchService.getActiveLaunch(ctx.user.id);
  }),
  getFailedLaunches: protectedRateLimitedProcedure.query(async ({ ctx }) => {
    return await launchService.getFailedLaunches(ctx.user.id);
  }),
  getUserLaunches: protectedRateLimitedProcedure.query(async ({ ctx }) => {
    return await launchService.getUserLaunches(ctx.user.id);
  }),
  recoveryWallets: protectedRateLimitedProcedure
    .input(launchRecoverySchema)
    .query(async ({ input, ctx }) => {
      return await launchService.getRecoveryWallets(input.launchId, ctx.user.id);
    }),
  recoveryWalletsByToken: protectedRateLimitedProcedure
    .input(launchRecoveryByTokenSchema)
    .query(async ({ input, ctx }) => {
      return await launchService.getRecoveryWalletsByToken(
        input.tokenPublicKey,
        ctx.user.id
      );
    }),
  recoverSol: sensitiveProcedure
    .input(launchRecoverSolSchema)
    .mutation(async ({ input, ctx }) => {
      return await launchService.recoverSol(
        input.launchId,
        ctx.user.id,
        input.walletPublicKeys
      );
    }),
  recoverSolByToken: sensitiveProcedure
    .input(launchRecoverSolByTokenSchema)
    .mutation(async ({ input, ctx }) => {
      return await launchService.recoverSolByToken(
        input.tokenPublicKey,
        ctx.user.id,
        input.walletPublicKeys
      );
    }),
});
