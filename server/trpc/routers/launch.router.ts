import { router, protectedProcedure } from "../trpc";
import { launchService } from "@/server/services/launch.service";
import { launchTokenSchema, launchStatusSchema } from "@/server/schemas/launch.schema";

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
});
