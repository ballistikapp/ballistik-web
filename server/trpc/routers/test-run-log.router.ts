import { protectedProcedure, router } from "../trpc";
import { appendTestRunLogEventSchema } from "@/server/schemas/test-run-log.schema";
import { testRunLogService } from "@/server/services/test-run-log.service";

export const testRunLogRouter = router({
  getConfig: protectedProcedure.query(() => {
    const config = testRunLogService.getConfig();
    return {
      enabled: config.enabled,
      runId: config.runId,
    };
  }),
  appendEvent: protectedProcedure
    .input(appendTestRunLogEventSchema)
    .mutation(async ({ input, ctx }) => {
      return await testRunLogService.appendClientEvent(input, ctx.user.id);
    }),
});
