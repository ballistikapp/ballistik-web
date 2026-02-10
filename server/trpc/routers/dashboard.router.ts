import { router, protectedProcedure } from "../trpc";
import { dashboardService } from "@/server/services/dashboard.service";
import {
  getDashboardStatsSchema,
  getDefiPoolsSchema,
} from "@/server/schemas/dashboard.schema";

export const dashboardRouter = router({
  getStats: protectedProcedure
    .input(getDashboardStatsSchema)
    .query(async ({ input, ctx }) => {
      return await dashboardService.getStats(input, ctx.user.id);
    }),
  getDefiPools: protectedProcedure
    .input(getDefiPoolsSchema)
    .query(async ({ input, ctx }) => {
      return await dashboardService.getDeFiPools(input, ctx.user.id);
    }),
});
