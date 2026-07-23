import {
  operatorProcedure,
  operatorSensitiveProcedure,
  router,
} from "../trpc";
import { opsService } from "@/server/services/ops.service";
import {
  opsCreateMarketerSchema,
  opsGetLaunchAutopsySchema,
  opsGetMarketerSchema,
  opsGetOverviewSchema,
  opsGetTokenSchema,
  opsGetUserSpineSchema,
  opsGetWalletSchema,
  opsListLaunchesSchema,
  opsListMarketersSchema,
  opsListTokensSchema,
  opsListUsersSchema,
  opsListWalletAppTransactionsSchema,
  opsJumpSchema,
  opsListWalletsSchema,
  opsLookupSchema,
  opsRefreshMatchingWalletBalancesSchema,
  opsRefreshWalletBalancesSchema,
  opsRevealPrivateKeySchema,
  opsUpdateMarketerSchema,
} from "@/server/schemas/ops.schema";
import {
  opsGetMarketerApplicationSchema,
  opsListMarketerApplicationsSchema,
  opsRejectMarketerApplicationSchema,
} from "@/server/schemas/marketer-application.schema";

export const opsRouter = router({
  getOverview: operatorProcedure
    .input(opsGetOverviewSchema)
    .query(async ({ ctx }) => {
      return await opsService.getOverview(ctx.user.id);
    }),

  listUsers: operatorProcedure
    .input(opsListUsersSchema)
    .query(async ({ input, ctx }) => {
      return await opsService.listUsers(ctx.user.id, input);
    }),

  listLaunches: operatorProcedure
    .input(opsListLaunchesSchema)
    .query(async ({ input, ctx }) => {
      return await opsService.listLaunches(ctx.user.id, input);
    }),

  listTokens: operatorProcedure
    .input(opsListTokensSchema)
    .query(async ({ input, ctx }) => {
      return await opsService.listTokens(ctx.user.id, input);
    }),

  listWallets: operatorProcedure
    .input(opsListWalletsSchema)
    .query(async ({ input, ctx }) => {
      return await opsService.listWallets(ctx.user.id, input);
    }),

  lookupUser: operatorProcedure
    .input(opsLookupSchema)
    .query(async ({ input, ctx }) => {
      return await opsService.lookupUser(ctx.user.id, input);
    }),

  jump: operatorProcedure
    .input(opsJumpSchema)
    .query(async ({ input, ctx }) => {
      return await opsService.jump(ctx.user.id, input);
    }),

  getUserSpine: operatorProcedure
    .input(opsGetUserSpineSchema)
    .query(async ({ input, ctx }) => {
      return await opsService.getUserSpine(ctx.user.id, input.userId);
    }),

  getToken: operatorProcedure
    .input(opsGetTokenSchema)
    .query(async ({ input, ctx }) => {
      return await opsService.getToken(ctx.user.id, input.publicKey);
    }),

  getWallet: operatorProcedure
    .input(opsGetWalletSchema)
    .query(async ({ input, ctx }) => {
      return await opsService.getWallet(ctx.user.id, input.publicKey);
    }),

  listWalletAppTransactions: operatorProcedure
    .input(opsListWalletAppTransactionsSchema)
    .query(async ({ input, ctx }) => {
      return await opsService.listWalletAppTransactions(ctx.user.id, input);
    }),

  refreshWalletBalances: operatorProcedure
    .input(opsRefreshWalletBalancesSchema)
    .mutation(async ({ input, ctx }) => {
      return await opsService.refreshWalletBalances(ctx.user.id, input);
    }),

  refreshMatchingWalletBalances: operatorProcedure
    .input(opsRefreshMatchingWalletBalancesSchema)
    .mutation(async ({ input, ctx }) => {
      return await opsService.refreshMatchingWalletBalances(ctx.user.id, input);
    }),

  getLaunchAutopsy: operatorProcedure
    .input(opsGetLaunchAutopsySchema)
    .query(async ({ input, ctx }) => {
      return await opsService.getLaunchAutopsy(ctx.user.id, input.launchId);
    }),

  revealPrivateKey: operatorSensitiveProcedure
    .input(opsRevealPrivateKeySchema)
    .mutation(async ({ input, ctx }) => {
      return await opsService.revealPrivateKey(ctx.user.id, input, {
        requestId: ctx.requestId,
        logger: ctx.logger,
      });
    }),

  listMarketers: operatorProcedure
    .input(opsListMarketersSchema)
    .query(async ({ input, ctx }) => {
      return await opsService.listMarketers(ctx.user.id, input);
    }),

  getMarketer: operatorProcedure
    .input(opsGetMarketerSchema)
    .query(async ({ input, ctx }) => {
      return await opsService.getMarketer(ctx.user.id, input);
    }),

  createMarketer: operatorProcedure
    .input(opsCreateMarketerSchema)
    .mutation(async ({ input, ctx }) => {
      return await opsService.createMarketer(ctx.user.id, input);
    }),

  updateMarketer: operatorProcedure
    .input(opsUpdateMarketerSchema)
    .mutation(async ({ input, ctx }) => {
      return await opsService.updateMarketer(ctx.user.id, input);
    }),

  listMarketerApplications: operatorProcedure
    .input(opsListMarketerApplicationsSchema)
    .query(async ({ input, ctx }) => {
      return await opsService.listMarketerApplications(ctx.user.id, input);
    }),

  getMarketerApplication: operatorProcedure
    .input(opsGetMarketerApplicationSchema)
    .query(async ({ input, ctx }) => {
      return await opsService.getMarketerApplication(ctx.user.id, input);
    }),

  rejectMarketerApplication: operatorProcedure
    .input(opsRejectMarketerApplicationSchema)
    .mutation(async ({ input, ctx }) => {
      return await opsService.rejectMarketerApplication(ctx.user.id, input);
    }),
});
