import "server-only";

import { prisma, Prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { isAppError } from "@/server/errors";
import { usageFeeService } from "@/server/services/usage-fee.service";
import {
  versionedLaunchInputSchema,
  type VersionedLaunchInput,
} from "@/server/schemas/launch-platform.schema";
import type { ContextUser } from "@/server/schemas/auth.schema";
import {
  assembleLaunchPlanEnvelope,
  LAUNCH_PLAN_SHELL_VERSION_V1,
} from "@/server/services/launch-plan-envelope";
import {
  mergeLaunchOptionsFeesIntoMoney,
  quoteLaunchOptionsFees,
} from "@/server/services/launch-options-money";
import { materializeLaunchOptionsOutcomes } from "@/server/services/launch-options-outcomes";
import {
  resolveLaunchPlatform,
  type LaunchLifecycleContext,
  type LaunchLogLevel,
  type LaunchPlatformExecuteResult,
  type LaunchPlatformModule,
  type LaunchPlatformPlanLocalResources,
} from "@/server/services/launch-platform-registry";

type RequestUser = Pick<ContextUser, "id" | "plan">;

type CollectUsageFeeInput = Parameters<
  typeof usageFeeService.collectFromMainWallet
>[0];

type LaunchExecutionRecord = {
  id: string;
  userId: string;
  platform: string | null;
  status: string;
  plan: unknown | null;
  planSchemaVersion: string | null;
  planPersistedAt: Date | null;
  input: unknown;
};

export type LaunchLifecycleDeps = {
  resolvePlatform: (platform: string) => LaunchPlatformModule;
  loadLaunch: (launchId: string) => Promise<LaunchExecutionRecord | null>;
  persistPlan: (
    launchId: string,
    planSchemaVersion: string,
    plan: unknown
  ) => Promise<void>;
  reportProgress: (
    launchId: string,
    progress: number,
    step?: string
  ) => Promise<void>;
  appendLog: (
    launchId: string,
    level: LaunchLogLevel,
    message: string,
    step?: string,
    data?: Record<string, unknown>
  ) => Promise<void>;
  isCancelRequested: (launchId: string) => Promise<boolean>;
  updateLaunchStatus: (
    launchId: string,
    status: "SUCCEEDED" | "FAILED" | "CANCELED",
    errorMessage?: string | null,
    outcome?: {
      kind: string;
      details?: Record<string, unknown> | null;
    }
  ) => Promise<void>;
  collectUsageFee: (
    input: CollectUsageFeeInput
  ) => ReturnType<typeof usageFeeService.collectFromMainWallet>;
};

function createLifecycleContext(
  launch: LaunchExecutionRecord,
  deps: LaunchLifecycleDeps,
  planOverride?: { plan: unknown | null; planSchemaVersion: string | null }
): LaunchLifecycleContext {
  return {
    launchId: launch.id,
    userId: launch.userId,
    plan: planOverride?.plan ?? launch.plan,
    planSchemaVersion:
      planOverride?.planSchemaVersion ?? launch.planSchemaVersion,
    reportProgress: (progress, step) =>
      deps.reportProgress(launch.id, progress, step),
    appendLog: (level, message, step, data) =>
      deps.appendLog(launch.id, level, message, step, data),
    isCancelRequested: () => deps.isCancelRequested(launch.id),
  };
}

function parseVersionedLaunchInput(raw: unknown): VersionedLaunchInput | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }
  const { entitlementSnapshot: _entitlementSnapshot, ...body } = raw as Record<
    string,
    unknown
  >;
  const parsed = versionedLaunchInputSchema.safeParse(body);
  return parsed.success ? parsed.data : null;
}

async function collectUsageFeeAfterSuccess(
  deps: LaunchLifecycleDeps,
  params: {
    launchId: string;
    userId: string;
    tokenPublicKey: string;
    usageFeeTotalSol: number;
  }
): Promise<void> {
  if (params.usageFeeTotalSol <= 0) {
    return;
  }

  try {
    const usageFeeResult = await deps.collectUsageFee({
      userId: params.userId,
      totalFeeSol: params.usageFeeTotalSol,
      reason: "launch.success",
      txSource: "LAUNCH",
      referenceId: params.launchId,
      tokenPublicKey: params.tokenPublicKey,
    });
    await deps.appendLog(params.launchId, "INFO", "Usage fee collected", "fees", {
      skipped: usageFeeResult.skipped,
      amountSol: usageFeeResult.amountSol,
      amountLamports: usageFeeResult.amountLamports,
      signature: usageFeeResult.signature,
      fromPublicKey: usageFeeResult.fromPublicKey,
      toPublicKey: usageFeeResult.toPublicKey,
      reason: usageFeeResult.reason,
    });
  } catch (error) {
    const message =
      (error instanceof Error && error.message) ||
      "Failed to collect usage fee";
    logger.warn("Launch usage fee collection on success failed", {
      launchId: params.launchId,
      userId: params.userId,
      errorMessage: message,
    });
    await deps.appendLog(
      params.launchId,
      "WARN",
      "Usage fee collection failed after successful launch",
      "fees",
      {
        amountSol: params.usageFeeTotalSol,
        errorMessage: message,
        reason: "launch.success",
      }
    );
  }
}

async function applyPlatformExecuteResult(
  deps: LaunchLifecycleDeps,
  launchId: string,
  result: LaunchPlatformExecuteResult
): Promise<void> {
  if (result.kind === "succeeded") {
    await collectUsageFeeAfterSuccess(deps, {
      launchId,
      userId: result.userId,
      tokenPublicKey: result.tokenPublicKey,
      usageFeeTotalSol: result.usageFeeTotalSol,
    });
    await deps.updateLaunchStatus(launchId, "SUCCEEDED", null, {
      kind: "succeeded",
      details: {
        tokenPublicKey: result.tokenPublicKey,
        ...(result.details ?? {}),
      },
    });
    return;
  }

  if (result.kind === "canceled") {
    await deps.updateLaunchStatus(launchId, "CANCELED", null, {
      kind: "canceled",
      details: result.details ?? null,
    });
    return;
  }

  if (result.kind === "partial" || result.kind === "indeterminate") {
    await deps.updateLaunchStatus(launchId, "FAILED", result.errorMessage, {
      kind: result.kind,
      details: {
        ...(result.tokenPublicKey
          ? { tokenPublicKey: result.tokenPublicKey }
          : {}),
        ...(result.details ?? {}),
      },
    });
    return;
  }

  await deps.updateLaunchStatus(launchId, "FAILED", result.errorMessage, {
    kind: "failed",
    details: result.details ?? null,
  });
}

async function compensateResources(
  platform: LaunchPlatformModule,
  ctx: LaunchLifecycleContext,
  resources: LaunchPlatformPlanLocalResources | undefined
): Promise<void> {
  if (!resources) {
    return;
  }
  if (
    !resources.reservedVanityMintId &&
    resources.createdWalletPublicKeys.length === 0
  ) {
    return;
  }
  await platform.compensatePlanResources(ctx, resources);
}

export function createLaunchLifecycle(deps: LaunchLifecycleDeps) {
  return {
    createContext(launch: LaunchExecutionRecord): LaunchLifecycleContext {
      return createLifecycleContext(launch, deps);
    },

    async runPlatformExecution(launchId: string): Promise<void> {
      const launch = await deps.loadLaunch(launchId);
      if (!launch) {
        return;
      }

      const platform = deps.resolvePlatform(launch.platform ?? "PUMPFUN");
      let plan = launch.plan;
      let planSchemaVersion = launch.planSchemaVersion;

      if (!launch.planPersistedAt) {
        const input = parseVersionedLaunchInput(launch.input);
        if (!input) {
          await deps.updateLaunchStatus(
            launch.id,
            "FAILED",
            "Launch input is no longer valid"
          );
          await deps.appendLog(
            launch.id,
            "ERROR",
            "Launch input is no longer valid",
            "plan"
          );
          return;
        }

        await deps.reportProgress(launch.id, 2, "plan");
        await deps.appendLog(
          launch.id,
          "STEP",
          "Building authoritative Platform plan",
          "plan"
        );

        const planCtx = createLifecycleContext(launch, deps, {
          plan: null,
          planSchemaVersion: null,
        });
        const planResult = await platform.plan(planCtx, input);

        if (planResult.kind === "failed") {
          await compensateResources(
            platform,
            planCtx,
            planResult.localResources
          );
          await deps.appendLog(
            launch.id,
            "ERROR",
            planResult.errorMessage,
            "plan"
          );
          await deps.updateLaunchStatus(
            launch.id,
            "FAILED",
            planResult.errorMessage
          );
          return;
        }

        let optionsResources: LaunchPlatformPlanLocalResources = {
          reservedVanityMintId: null,
          createdWalletPublicKeys: [],
        };
        try {
          const materialized = await materializeLaunchOptionsOutcomes({
            launchId: launch.id,
            userId: launch.userId,
            options: input.options,
          });
          optionsResources = {
            reservedVanityMintId:
              materialized.localResources.reservedVanityMintId,
            createdWalletPublicKeys: [],
          };

          const optionsFees = quoteLaunchOptionsFees(input.options, {
            platformFeeWaived: planResult.platformFeeWaived,
            platformFeeDiscountRate: planResult.platformFeeDiscountRate,
          });
          const money = mergeLaunchOptionsFeesIntoMoney(
            planResult.money,
            optionsFees
          );
          const required = BigInt(money.immediateRequiredBalanceLamports);
          const balance = BigInt(planResult.mainWalletBalanceLamports);
          if (balance < required) {
            await compensateResources(platform, planCtx, {
              reservedVanityMintId: optionsResources.reservedVanityMintId,
              createdWalletPublicKeys:
                planResult.localResources?.createdWalletPublicKeys ?? [],
            });
            const message = `Main wallet requires ${(Number(required) / 1_000_000_000).toFixed(4)} SOL to fund launch wallets and usage fees`;
            await deps.appendLog(launch.id, "ERROR", message, "plan");
            await deps.updateLaunchStatus(launch.id, "FAILED", message);
            return;
          }

          const envelope = assembleLaunchPlanEnvelope({
            optionsOutcomes: materialized.optionsOutcomes,
            money,
            platformPlan: planResult.plan,
          });

          await deps.persistPlan(
            launch.id,
            LAUNCH_PLAN_SHELL_VERSION_V1,
            envelope
          );
          plan = envelope;
          planSchemaVersion = LAUNCH_PLAN_SHELL_VERSION_V1;
        } catch (error) {
          await compensateResources(platform, planCtx, {
            reservedVanityMintId: optionsResources.reservedVanityMintId,
            createdWalletPublicKeys:
              planResult.localResources?.createdWalletPublicKeys ?? [],
          });
          const message =
            (error instanceof Error && error.message) ||
            "Failed to persist authoritative plan";
          const isOptionsFailure =
            isAppError(error) ||
            (error instanceof Error && /vanity mint/i.test(error.message));
          logger.error("Launch plan persistence failed", {
            launchId: launch.id,
            errorMessage: message,
          });
          await deps.appendLog(
            launch.id,
            "ERROR",
            isOptionsFailure ? message : "Failed to persist authoritative plan",
            "plan",
            { errorMessage: message }
          );
          await deps.updateLaunchStatus(
            launch.id,
            "FAILED",
            isOptionsFailure ? message : "Failed to persist authoritative plan"
          );
          return;
        }

        await deps.appendLog(
          launch.id,
          "INFO",
          "Authoritative Platform plan persisted",
          "plan",
          { planSchemaVersion }
        );
      } else if (!planSchemaVersion || plan == null) {
        await deps.updateLaunchStatus(
          launch.id,
          "FAILED",
          "Persisted launch plan is incomplete and cannot be executed"
        );
        await deps.appendLog(
          launch.id,
          "ERROR",
          "Persisted launch plan is incomplete and cannot be executed",
          "plan"
        );
        return;
      }

      const ctx = createLifecycleContext(launch, deps, {
        plan,
        planSchemaVersion,
      });
      const result = await platform.execute(ctx);
      await applyPlatformExecuteResult(deps, launch.id, result);
    },

    async collectUsageFeeAfterSuccess(params: {
      launchId: string;
      userId: string;
      tokenPublicKey: string;
      usageFeeTotalSol: number;
    }): Promise<void> {
      await collectUsageFeeAfterSuccess(deps, params);
    },
  };
}

async function defaultAppendLog(
  launchId: string,
  level: LaunchLogLevel,
  message: string,
  step?: string,
  data?: Record<string, unknown>
) {
  const logData: Prisma.LaunchLogUncheckedCreateInput = {
    launchId,
    level,
    message,
    step: step ?? null,
    ...(data === undefined
      ? {}
      : { data: data as Prisma.InputJsonValue }),
  };
  await prisma.launchLog.create({ data: logData });
  const context: Record<string, unknown> = {
    launchId,
    step,
    launchLevel: level,
  };
  if (data) {
    Object.assign(context, data);
  }
  if (level === "ERROR") {
    logger.error(message, context);
  } else if (level === "WARN") {
    logger.warn(message, context);
  } else {
    logger.info(message, context);
  }
}

const defaultDeps: LaunchLifecycleDeps = {
  resolvePlatform: resolveLaunchPlatform,
  loadLaunch: async (launchId) => {
    const launch = await prisma.launch.findUnique({
      where: { id: launchId },
      select: {
        id: true,
        userId: true,
        platform: true,
        status: true,
        plan: true,
        planSchemaVersion: true,
        planPersistedAt: true,
        input: true,
      },
    });
    return launch;
  },
  persistPlan: async (launchId, planSchemaVersion, plan) => {
    await prisma.launch.update({
      where: { id: launchId },
      data: {
        plan: plan as Prisma.InputJsonValue,
        planSchemaVersion,
        planPersistedAt: new Date(),
      },
    });
  },
  reportProgress: async (launchId, progress, step) => {
    await prisma.launch.update({
      where: { id: launchId },
      data: {
        progress,
        ...(step === undefined ? {} : { currentStep: step }),
      },
    });
  },
  appendLog: defaultAppendLog,
  isCancelRequested: async (launchId) => {
    const launch = await prisma.launch.findUnique({
      where: { id: launchId },
      select: { cancelRequestedAt: true },
    });
    return Boolean(launch?.cancelRequestedAt);
  },
  updateLaunchStatus: async (launchId, status, errorMessage, outcome) => {
    await prisma.launch.update({
      where: { id: launchId },
      data: {
        status,
        ...(errorMessage === undefined ? {} : { errorMessage }),
        completedAt: new Date(),
        ...(status === "SUCCEEDED" || status === "CANCELED" || status === "FAILED"
          ? { progress: 100 }
          : {}),
        ...(outcome
          ? {
              outcomeKind: outcome.kind,
              outcomeDetails:
                outcome.details === undefined || outcome.details === null
                  ? Prisma.JsonNull
                  : (outcome.details as Prisma.InputJsonValue),
            }
          : {}),
      },
    });
  },
  collectUsageFee: (input) => usageFeeService.collectFromMainWallet(input),
};

const lifecycle = createLaunchLifecycle(defaultDeps);

/**
 * Shared Launch lifecycle: router-facing start/status/cancel/retry/active,
 * plan durability before execute, Platform execution scheduling, and
 * post-success fee orchestration.
 * Heavy pump.fun job work remains in launch.service; Platform execute returns
 * typed outcomes that this module maps to Launch status and outcomeKind.
 */
export const launchLifecycle = {
  async startLaunch(input: VersionedLaunchInput, user: RequestUser) {
    const { launchService } = await import("./launch.service");
    return await launchService.startLaunch(input, user);
  },

  async retryLaunch(launchId: string, user: RequestUser) {
    const { launchService } = await import("./launch.service");
    return await launchService.retryLaunch(launchId, user);
  },

  async cancelLaunch(launchId: string, userId: string) {
    const { launchService } = await import("./launch.service");
    return await launchService.cancelLaunch(launchId, userId);
  },

  async getLaunchStatus(launchId: string, userId: string) {
    const { launchService } = await import("./launch.service");
    return await launchService.getLaunchStatus(launchId, userId);
  },

  async getActiveLaunch(userId: string) {
    const { launchService } = await import("./launch.service");
    return await launchService.getActiveLaunch(userId);
  },

  runPlatformExecution: lifecycle.runPlatformExecution,
  collectUsageFeeAfterSuccess: lifecycle.collectUsageFeeAfterSuccess,
  createContext: lifecycle.createContext,
};
