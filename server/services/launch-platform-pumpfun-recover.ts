import "server-only";

import { AppError } from "@/server/errors";
import { requirePumpfunExecutePlan } from "@/server/services/launch-platform-pumpfun-execute";
import type {
  LaunchLifecycleContext,
  LaunchPlatformRecoverResult,
} from "@/server/services/launch-platform-registry";

export type PumpfunRecoverDeps = {
  reclaimFromPersistedState: (
    launchId: string,
    userId: string,
    walletPublicKeys?: string[]
  ) => Promise<LaunchPlatformRecoverResult>;
};

/**
 * Platform recover: validate persisted plan when present, then reclaim from
 * durable Launch / Managed Launch Wallet evidence. Never depends on in-memory
 * job state. Funded-cap enforcement lives in the reclaim implementation.
 */
export async function runPumpfunRecover(
  ctx: LaunchLifecycleContext,
  options: { walletPublicKeys?: string[] } | undefined,
  deps: PumpfunRecoverDeps
): Promise<LaunchPlatformRecoverResult> {
  if (ctx.plan != null || ctx.planSchemaVersion != null) {
    try {
      requirePumpfunExecutePlan(ctx);
    } catch (error) {
      if (error instanceof AppError && error.statusCode === 500) {
        throw new AppError(
          "Persisted launch plan is invalid and cannot be used for recovery",
          400
        );
      }
      throw error;
    }
  }

  return deps.reclaimFromPersistedState(
    ctx.launchId,
    ctx.userId,
    options?.walletPublicKeys
  );
}

async function defaultReclaimFromPersistedState(
  launchId: string,
  userId: string,
  walletPublicKeys?: string[]
): Promise<LaunchPlatformRecoverResult> {
  const { recoverPumpfunLaunchSolFromPersistedState } = await import(
    "./launch.service"
  );
  return recoverPumpfunLaunchSolFromPersistedState(
    launchId,
    userId,
    walletPublicKeys
  );
}

export async function runPumpfunRecoverDefault(
  ctx: LaunchLifecycleContext,
  options?: { walletPublicKeys?: string[] }
): Promise<LaunchPlatformRecoverResult> {
  return runPumpfunRecover(ctx, options, {
    reclaimFromPersistedState: defaultReclaimFromPersistedState,
  });
}
