import {
  operatorProcedure,
  operatorSensitiveProcedure,
  router,
} from "../trpc";
import { opsService } from "@/server/services/ops.service";
import {
  opsGetLaunchAutopsySchema,
  opsGetOverviewSchema,
  opsGetUserSpineSchema,
  opsListLaunchesSchema,
  opsListUsersSchema,
  opsLookupSchema,
  opsRevealPrivateKeySchema,
} from "@/server/schemas/ops.schema";

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

  lookupUser: operatorProcedure
    .input(opsLookupSchema)
    .query(async ({ input, ctx }) => {
      return await opsService.lookupUser(ctx.user.id, input);
    }),

  getUserSpine: operatorProcedure
    .input(opsGetUserSpineSchema)
    .query(async ({ input, ctx }) => {
      return await opsService.getUserSpine(ctx.user.id, input.userId);
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
});