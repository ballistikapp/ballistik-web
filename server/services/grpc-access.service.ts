import "server-only";
import { getEnv } from "@/lib/config/env";
import { UserPlan } from "@/lib/generated/prisma/client";
import type { ContextUser } from "@/server/schemas/auth.schema";
import { DEVELOPER_FEE_DISCOUNT_RATE } from "@/lib/config/subscription.config";

export type GrpcFeature =
  | "dashboard-live-monitoring"
  | "launch-fast-confirmation"
  | "bundle-fast-confirmation"
  | "volume-bot-realtime";

export type GrpcAccessReason =
  | "ok"
  | "not_authenticated"
  | "not_pro"
  | "grpc_disabled"
  | "grpc_not_configured";

type UserLike = Pick<ContextUser, "plan"> | null;

const FREE_VOLUME_BOT_MIN_INTERVAL_SECONDS = 5;

function resolveInfraState() {
  const { SHYFT_GRPC_TOKEN, GRPC_ACCESS_MODE } = getEnv();
  const tokenConfigured = Boolean(SHYFT_GRPC_TOKEN?.trim());
  const globallyEnabled = GRPC_ACCESS_MODE !== "off";

  return {
    accessMode: GRPC_ACCESS_MODE,
    tokenConfigured,
    globallyEnabled,
    infraAvailable: tokenConfigured && globallyEnabled,
  };
}

function resolvePlan(user: UserLike) {
  return user?.plan ?? null;
}

export const grpcAccessService = {
  getInfraState() {
    return resolveInfraState();
  },

  getFeatureAccess(user: UserLike, feature: GrpcFeature) {
    void feature;
    const infra = resolveInfraState();
    if (!infra.globallyEnabled) {
      return { allowed: false, reason: "grpc_disabled" as const, ...infra };
    }
    if (!infra.tokenConfigured) {
      return { allowed: false, reason: "grpc_not_configured" as const, ...infra };
    }
    if (infra.accessMode === "all") {
      return { allowed: true, reason: "ok" as const, ...infra };
    }

    const plan = resolvePlan(user);
    if (!plan) {
      return { allowed: false, reason: "not_authenticated" as const, ...infra };
    }
    if (plan !== UserPlan.PRO) {
      return { allowed: false, reason: "not_pro" as const, ...infra };
    }

    return { allowed: true, reason: "ok" as const, ...infra };
  },

  isPlatformFeeWaived(user: UserLike) {
    return resolvePlan(user) === UserPlan.PRO;
  },

  getPlatformFeeDiscountRate(user: UserLike): number {
    const plan = resolvePlan(user);
    if (plan === UserPlan.PRO) return 1;
    if (plan === UserPlan.DEVELOPER) return DEVELOPER_FEE_DISCOUNT_RATE;
    return 0;
  },

  getVolumeBotMinIntervalSeconds(user: UserLike) {
    const access = this.getFeatureAccess(user, "volume-bot-realtime");
    return access.allowed ? 1 : FREE_VOLUME_BOT_MIN_INTERVAL_SECONDS;
  },
};
