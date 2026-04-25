import { protectedRateLimitedProcedure, router } from "../trpc";
import { activeProcessService } from "@/server/services/active-process.service";

export const activeProcessRouter = router({
  list: protectedRateLimitedProcedure.query(async ({ ctx }) => {
    return await activeProcessService.list(ctx.user.id);
  }),
});
