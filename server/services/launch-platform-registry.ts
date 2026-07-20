import "server-only";

import { AppError } from "@/server/errors";
import type {
  LaunchPlatformId,
  NormalizedLaunchMoneySummary,
  VersionedLaunchInput,
} from "@/server/schemas/launch-platform.schema";
import { launchPlatformIdSchema } from "@/server/schemas/launch-platform.schema";

export type LaunchLogLevel = "INFO" | "WARN" | "ERROR" | "STEP";

/**
 * Narrow lifecycle context passed into Platform modules.
 * Platforms report progress/events and query cancellation here; they must not
 * write Launch / LaunchLog rows directly (compat execute may still do so until
 * later extraction tickets).
 */
export type LaunchLifecycleContext = {
  launchId: string;
  userId: string;
  reportProgress: (progress: number, step?: string) => Promise<void>;
  appendLog: (
    level: LaunchLogLevel,
    message: string,
    step?: string,
    data?: Record<string, unknown>
  ) => Promise<void>;
  isCancelRequested: () => Promise<boolean>;
};

/**
 * Typed execute outcomes. `compat` means the Platform delegate already applied
 * terminal status and fee timing (current pump.fun job path).
 */
export type LaunchPlatformExecuteResult =
  | { kind: "compat" }
  | {
      kind: "succeeded";
      usageFeeTotalSol: number;
      userId: string;
      tokenPublicKey: string;
      referenceId: string;
    }
  | { kind: "failed"; errorMessage: string }
  | { kind: "canceled" };

export type LaunchPlatformPlanResult = {
  planSchemaVersion: number;
  plan: unknown;
};

/**
 * Shared Platform module interface. preview / plan / recover deepen in later
 * tickets; execute initially delegates to pump.fun compatibility code.
 */
export type LaunchPlatformModule = {
  readonly id: LaunchPlatformId;
  preview: (input: VersionedLaunchInput) => Promise<NormalizedLaunchMoneySummary>;
  plan: (
    ctx: LaunchLifecycleContext,
    input: VersionedLaunchInput
  ) => Promise<LaunchPlatformPlanResult>;
  execute: (ctx: LaunchLifecycleContext) => Promise<LaunchPlatformExecuteResult>;
  recover: (ctx: LaunchLifecycleContext) => Promise<void>;
};

type LaunchPlatformRegistry = Record<LaunchPlatformId, LaunchPlatformModule>;

let registry: LaunchPlatformRegistry | null = null;

function notExtractedYet(operation: string): never {
  throw new AppError(
    `pump.fun Platform ${operation} is not extracted yet`,
    501,
    { operation }
  );
}

function createPumpfunCompatModule(): LaunchPlatformModule {
  return {
    id: "PUMPFUN",
    preview: async () => notExtractedYet("preview"),
    plan: async () => notExtractedYet("plan"),
    execute: async (ctx) => {
      // Dynamic import avoids a load-time cycle with launch.service.
      const { runPumpfunLaunchJobCompat } = await import(
        "./launch-platform-pumpfun"
      );
      await runPumpfunLaunchJobCompat(ctx.launchId);
      return { kind: "compat" };
    },
    recover: async () => notExtractedYet("recover"),
  };
}

function getRegistry(): LaunchPlatformRegistry {
  if (!registry) {
    registry = {
      PUMPFUN: createPumpfunCompatModule(),
    };
  }
  return registry;
}

/**
 * Resolve a launch Platform module. Unsupported Platforms fail before
 * Launch record creation (callers must validate/resolve before persistence).
 */
export function resolveLaunchPlatform(platform: string): LaunchPlatformModule {
  const parsed = launchPlatformIdSchema.safeParse(platform);
  if (!parsed.success) {
    throw new AppError(`Unsupported launch Platform: ${platform}`, 400, {
      platform,
    });
  }
  return getRegistry()[parsed.data];
}
