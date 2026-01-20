import { router, protectedProcedure } from "../trpc";
import { refreshCacheService } from "@/server/services/refresh-cache.service";
import { getRefreshCacheSchema } from "@/server/schemas/refresh-cache.schema";

export const refreshCacheRouter = router({
  getByScope: protectedProcedure
    .input(getRefreshCacheSchema)
    .query(async ({ input, ctx }) => {
      return await refreshCacheService.getByScope(input, ctx.user.id);
    }),
});
