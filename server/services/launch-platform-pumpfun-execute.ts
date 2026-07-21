import "server-only";

import { AppError } from "@/server/errors";
import {
  pumpfunLaunchPlanV1Schema,
  type PumpfunLaunchPlanV1,
} from "@/server/schemas/launch-platform.schema";
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
 * Validate the persisted pump.fun plan on the lifecycle context.
 * Execute must never silent-replan or trust unparsed opaque JSON.
 */
export function requirePumpfunExecutePlan(
  ctx: Pick<LaunchLifecycleContext, "plan" | "planSchemaVersion">
): PumpfunLaunchPlanV1 {
  if (ctx.plan == null || ctx.planSchemaVersion == null) {
    throw new AppError(
      "Persisted launch plan is required before pump.fun execute",
      500
    );
  }

  const parsed = pumpfunLaunchPlanV1Schema.safeParse(ctx.plan);
  if (!parsed.success) {
    throw new AppError(
      "Persisted launch plan is invalid and cannot be executed",
      500,
      { issues: parsed.error.issues }
    );
  }

  if (parsed.data.schemaVersion !== ctx.planSchemaVersion) {
    throw new AppError(
      "Persisted launch plan schema version does not match Launch record",
      500,
      {
        planSchemaVersion: parsed.data.schemaVersion,
        launchPlanSchemaVersion: ctx.planSchemaVersion,
      }
    );
  }

  assertNonSystemCreatorWalletOption(parsed.data.wallets.creatorWalletOption);
  return parsed.data;
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
