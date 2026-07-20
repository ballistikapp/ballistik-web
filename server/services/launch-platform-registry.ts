import "server-only";

import { AppError } from "@/server/errors";
import type { LaunchPlatformId } from "@/server/schemas/launch-platform.schema";
import { launchPlatformIdSchema } from "@/server/schemas/launch-platform.schema";

/**
 * Typed Platform module identity resolved by the registry.
 * preview / plan / execute / recover land in later tickets.
 */
export type LaunchPlatformModule = {
  readonly id: LaunchPlatformId;
};

const pumpfunPlatform: LaunchPlatformModule = {
  id: "PUMPFUN",
};

const registry: Record<LaunchPlatformId, LaunchPlatformModule> = {
  PUMPFUN: pumpfunPlatform,
};

/**
 * Resolve a launch Platform module. Unsupported Platforms fail before
 * Launch record creation (callers must validate/resolve before persistence).
 */
export function resolveLaunchPlatform(
  platform: string
): LaunchPlatformModule {
  const parsed = launchPlatformIdSchema.safeParse(platform);
  if (!parsed.success) {
    throw new AppError(`Unsupported launch Platform: ${platform}`, 400, {
      platform,
    });
  }
  return registry[parsed.data];
}
