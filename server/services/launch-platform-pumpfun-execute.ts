import "server-only";

import { AppError } from "@/server/errors";
import {
  pumpfunLaunchPlanV1Schema,
  type LaunchPlanEnvelopeV1,
  type PumpfunLaunchPlanV1,
} from "@/server/schemas/launch-platform.schema";
import { requireLaunchPlanEnvelope } from "@/server/services/launch-plan-envelope";
import type {
  LaunchLifecycleContext,
  LaunchPlatformExecuteResult,
} from "@/server/services/launch-platform-registry";

const SUPPORTED_CREATOR_OPTIONS = ["import", "generate", "use_main"] as const;

type SupportedCreatorWalletOption = (typeof SUPPORTED_CREATOR_OPTIONS)[number];

function isSupportedCreatorWalletOption(
  value: string
): value is SupportedCreatorWalletOption {
  return (SUPPORTED_CREATOR_OPTIONS as readonly string[]).includes(value);
}

/**
 * Validate the persisted Launch plan envelope and return the pump.fun platform plan.
 * Execute must never silent-replan or trust unparsed opaque JSON.
 */
export function requirePumpfunExecutePlan(
  ctx: Pick<LaunchLifecycleContext, "plan" | "planSchemaVersion">
): PumpfunLaunchPlanV1 {
  return requirePumpfunExecuteEnvelope(ctx).platformPlan;
}

export type PumpfunExecuteEnvelope = ReturnType<
  typeof requirePumpfunExecuteEnvelope
>;

/** Validate the persisted Launch plan envelope (optionsOutcomes + platformPlan). */
export function requirePumpfunExecuteEnvelope(
  ctx: Pick<LaunchLifecycleContext, "plan" | "planSchemaVersion">
): LaunchPlanEnvelopeV1 & { platformPlan: PumpfunLaunchPlanV1 } {
  const envelope = requireLaunchPlanEnvelope(ctx.plan, ctx.planSchemaVersion);
  const platformPlan = pumpfunLaunchPlanV1Schema.safeParse(envelope.platformPlan);
  if (!platformPlan.success) {
    throw new AppError(
      "Persisted launch plan is invalid and cannot be executed",
      500,
      { issues: platformPlan.error.issues }
    );
  }
  assertNonSystemCreatorWalletOption(
    platformPlan.data.wallets.creatorWalletOption
  );
  return { ...envelope, platformPlan: platformPlan.data };
}

/**
 * New-version execution rejects the removed system creator path even if
 * unexpected input reaches execute.
 */
export function assertNonSystemCreatorWalletOption(
  creatorWalletOption: string
): void {
  if (creatorWalletOption === "system") {
    throw new AppError(
      "The platform dev wallet is no longer available for new launches",
      400
    );
  }
  if (!isSupportedCreatorWalletOption(creatorWalletOption)) {
    throw new AppError(
      `Unsupported pump.fun creator wallet option: ${creatorWalletOption}`,
      400
    );
  }
}

export type PumpfunNonBundledExecuteDeps = {
  runNonBundledJob: (launchId: string) => Promise<LaunchPlatformExecuteResult>;
};

export type PumpfunBundledExecuteDeps = {
  runBundledJob: (launchId: string) => Promise<LaunchPlatformExecuteResult>;
};

/**
 * Non-bundled pump.fun execute entry: validate plan, then run the Platform-owned
 * non-bundled job (raw create / create+dev-buy). Does not use PumpFunSDK.
 */
export async function runPumpfunNonBundledExecute(
  ctx: LaunchLifecycleContext,
  deps: PumpfunNonBundledExecuteDeps
): Promise<LaunchPlatformExecuteResult> {
  const plan = requirePumpfunExecutePlan(ctx);
  if (plan.intendedEffects.bundleBuyEnabled) {
    throw new AppError(
      "Bundled launches must execute through the bundled Platform path",
      500
    );
  }
  return deps.runNonBundledJob(ctx.launchId);
}

/**
 * Bundled pump.fun execute entry: validate plan, then run the Platform-owned
 * bundled job (raw create + buys via Jito). Does not use PumpFunSDK.
 */
export async function runPumpfunBundledExecute(
  ctx: LaunchLifecycleContext,
  deps: PumpfunBundledExecuteDeps
): Promise<LaunchPlatformExecuteResult> {
  const plan = requirePumpfunExecutePlan(ctx);
  if (!plan.intendedEffects.bundleBuyEnabled) {
    throw new AppError(
      "Non-bundled launches must execute through the non-bundled Platform path",
      500
    );
  }
  return deps.runBundledJob(ctx.launchId);
}

async function defaultRunNonBundledJob(
  launchId: string
): Promise<LaunchPlatformExecuteResult> {
  const { runNonBundledPumpfunLaunchJob } = await import("./launch.service");
  return runNonBundledPumpfunLaunchJob(launchId);
}

async function defaultRunBundledJob(
  launchId: string
): Promise<LaunchPlatformExecuteResult> {
  const { runBundledPumpfunLaunchJob } = await import("./launch.service");
  return runBundledPumpfunLaunchJob(launchId);
}

export async function runPumpfunNonBundledExecuteDefault(
  ctx: LaunchLifecycleContext
): Promise<LaunchPlatformExecuteResult> {
  return runPumpfunNonBundledExecute(ctx, {
    runNonBundledJob: defaultRunNonBundledJob,
  });
}

export async function runPumpfunBundledExecuteDefault(
  ctx: LaunchLifecycleContext
): Promise<LaunchPlatformExecuteResult> {
  return runPumpfunBundledExecute(ctx, {
    runBundledJob: defaultRunBundledJob,
  });
}
