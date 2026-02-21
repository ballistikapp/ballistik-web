import { router, protectedProcedure } from "../trpc";
import { dashboardService } from "@/server/services/dashboard.service";
import {
  getDashboardStatsSchema,
  getDefiPoolsSchema,
} from "@/server/schemas/dashboard.schema";
import { grpcManager } from "@/server/solana/grpc-manager";

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
  getGrpcStatus: protectedProcedure.query(() => {
    const status = grpcManager.getStatus();
    return {
      available: status.enabled,
      connected: status.connected,
      lastError: status.lastError,
    };
  }),
});
