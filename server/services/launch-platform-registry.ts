import "server-only";

import { AppError } from "@/server/errors";
import type { ContextUser } from "@/server/schemas/auth.schema";
import type {
  LaunchPlatformId,
  LaunchPlatformPreviewResult,
  VersionedLaunchInput,
  VersionedLaunchPreviewInput,
} from "@/server/schemas/launch-platform.schema";
import { launchPlatformIdSchema } from "@/server/schemas/launch-platform.schema";
import { createPumpfunPlatformModule } from "@/server/services/launch-platform-pumpfun";

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

export type LaunchPlatformPreviewContext = {
  user: Pick<ContextUser, "id" | "plan">;
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
 * Shared Platform module interface.
 * preview returns normalized money plus the thin review envelope fields.
 * plan / recover deepen in later tickets; execute initially delegates to
 * pump.fun compatibility code.
 */
export type LaunchPlatformModule = {
  readonly id: LaunchPlatformId;
  preview: (
    input: VersionedLaunchPreviewInput,
    ctx: LaunchPlatformPreviewContext
  ) => Promise<LaunchPlatformPreviewResult>;
  plan: (
    ctx: LaunchLifecycleContext,
    input: VersionedLaunchInput
  ) => Promise<LaunchPlatformPlanResult>;
  execute: (ctx: LaunchLifecycleContext) => Promise<LaunchPlatformExecuteResult>;
  recover: (ctx: LaunchLifecycleContext) => Promise<void>;
};

type LaunchPlatformRegistry = Record<LaunchPlatformId, LaunchPlatformModule>;

let registry: LaunchPlatformRegistry | null = null;

function getRegistry(): LaunchPlatformRegistry {
  if (!registry) {
    registry = {
      PUMPFUN: createPumpfunPlatformModule(),
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

/** Test helper to replace the registry between unit tests. */
export function __setLaunchPlatformRegistryForTests(
  next: LaunchPlatformRegistry | null
): void {
  registry = next;
}
