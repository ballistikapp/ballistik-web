import { router, protectedProcedure } from "../trpc";
import { dashboardService } from "@/server/services/dashboard.service";
import {
  getDashboardStatsSchema,
  getDefiPoolsSchema,
} from "@/server/schemas/dashboard.schema";
import { grpcManager } from "@/server/solana/grpc-manager";
import { ingestionQueue } from "@/server/services/ingestion-queue.service";
import { getEnv } from "@/lib/config/env";
import { grpcAccessService } from "@/server/services/grpc-access.service";
import { UserPlan } from "@/lib/generated/prisma/client";

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
  getGrpcStatus: protectedProcedure.query(({ ctx }) => {
    const status = grpcManager.getStatus();
    const ingestionStatus = ingestionQueue.getStatus();
    const { MONITORING_PIPELINE_V2 } = getEnv();
    const access = grpcAccessService.getFeatureAccess(
      ctx.user,
      "dashboard-live-monitoring"
    );
    const entitled =
      access.accessMode === "all" || ctx.user.plan === UserPlan.PRO;
    const accessReason = entitled ? access.reason : "not_pro";
    return {
      available: access.allowed,
      entitled,
      accessReason,
      infraAvailable: access.infraAvailable,
      tokenConfigured: access.tokenConfigured,
      accessMode: access.accessMode,
      connected: status.connected,
      lastError: status.lastError,
      monitoringPipelineV2: MONITORING_PIPELINE_V2,
      endpointType: status.endpointType,
      subscriptionCount: status.subscriptionCount,
      accountCount: status.accountCount,
      reconnecting: status.reconnecting,
      lastEventAt: status.lastEventAt,
      lastWriteFailureAt: status.lastWriteFailureAt,
      metrics: status.metrics,
      ingestion: {
        queueCount: ingestionStatus.queueCount,
        tokens: ingestionStatus.tokens.map((token) => ({
          tokenPublicKey: token.tokenPublicKey,
          pendingSignatures: token.pendingSignatures,
          flushing: token.flushing,
          retryCount: token.retryCount,
          lastFailureAt: token.lastFailureAt,
        })),
      },
    };
  }),
});
