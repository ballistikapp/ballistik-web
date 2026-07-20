import "server-only";

import { prisma, Prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { usageFeeService } from "@/server/services/usage-fee.service";
import type { VersionedLaunchInput } from "@/server/schemas/launch-platform.schema";
import type { ContextUser } from "@/server/schemas/auth.schema";
import {
  resolveLaunchPlatform,
  type LaunchLifecycleContext,
  type LaunchLogLevel,
  type LaunchPlatformExecuteResult,
  type LaunchPlatformModule,
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
};

export type LaunchLifecycleDeps = {
  resolvePlatform: (platform: string) => LaunchPlatformModule;
  loadLaunch: (launchId: string) => Promise<LaunchExecutionRecord | null>;
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
    errorMessage?: string | null
  ) => Promise<void>;
  collectUsageFee: (
    input: CollectUsageFeeInput
  ) => ReturnType<typeof usageFeeService.collectFromMainWallet>;
};

function createLifecycleContext(
  launch: LaunchExecutionRecord,
  deps: LaunchLifecycleDeps
): LaunchLifecycleContext {
  return {
    launchId: launch.id,
    userId: launch.userId,
    reportProgress: (progress, step) =>
      deps.reportProgress(launch.id, progress, step),
    appendLog: (level, message, step, data) =>
      deps.appendLog(launch.id, level, message, step, data),
    isCancelRequested: () => deps.isCancelRequested(launch.id),
  };
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
  if (result.kind === "compat") {
    return;
  }

  if (result.kind === "succeeded") {
    await collectUsageFeeAfterSuccess(deps, {
      launchId,
      userId: result.userId,
      tokenPublicKey: result.tokenPublicKey,
      usageFeeTotalSol: result.usageFeeTotalSol,
    });
    await deps.updateLaunchStatus(launchId, "SUCCEEDED", null);
    return;
  }

  if (result.kind === "canceled") {
    await deps.updateLaunchStatus(launchId, "CANCELED", null);
    return;
  }

  await deps.updateLaunchStatus(launchId, "FAILED", result.errorMessage);
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
      const ctx = createLifecycleContext(launch, deps);
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
      },
    });
    return launch;
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
  updateLaunchStatus: async (launchId, status, errorMessage) => {
    await prisma.launch.update({
      where: { id: launchId },
      data: {
        status,
        ...(errorMessage === undefined ? {} : { errorMessage }),
        completedAt: new Date(),
        ...(status === "SUCCEEDED" || status === "CANCELED" || status === "FAILED"
          ? { progress: 100 }
          : {}),
      },
    });
  },
  collectUsageFee: (input) => usageFeeService.collectFromMainWallet(input),
};

const lifecycle = createLaunchLifecycle(defaultDeps);

/**
 * Shared Launch lifecycle: router-facing start/status/cancel/retry/active,
 * Platform execution scheduling, and post-success fee orchestration.
 * Heavy pump.fun job work remains in launch.service via Platform compat execute.
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
