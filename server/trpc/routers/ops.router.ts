import {
  protectedProcedure,
  router,
  sensitiveProcedure,
} from "../trpc";
import { opsService } from "@/server/services/ops.service";
import {
  opsGetLaunchAutopsySchema,
  opsGetUserSpineSchema,
  opsLookupSchema,
  opsRevealPrivateKeySchema,
} from "@/server/schemas/ops.schema";

export const opsRouter = router({
  lookupUser: protectedProcedure
    .input(opsLookupSchema)
    .query(async ({ input, ctx }) => {
      return await opsService.lookupUser(ctx.user.id, input);
    }),

  getUserSpine: protectedProcedure
    .input(opsGetUserSpineSchema)
    .query(async ({ input, ctx }) => {
      return await opsService.getUserSpine(ctx.user.id, input.userId);
    }),

  getLaunchAutopsy: protectedProcedure
    .input(opsGetLaunchAutopsySchema)
    .query(async ({ input, ctx }) => {
      return await opsService.getLaunchAutopsy(ctx.user.id, input.launchId);
    }),

  revealPrivateKey: sensitiveProcedure
    .input(opsRevealPrivateKeySchema)
    .mutation(async ({ input, ctx }) => {
      return await opsService.revealPrivateKey(ctx.user.id, input, {
        requestId: ctx.requestId,
        logger: ctx.logger,
      });
    }),
});
