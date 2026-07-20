import "server-only";

import {
  isLegacyPlatformVersion,
  legacyCapabilityDeniedMessage,
  type LegacyDeniedCapability,
} from "@/lib/launch/legacy-capability";
import { AppError } from "@/server/errors";

export type { LegacyDeniedCapability };
export { legacyCapabilityDeniedMessage };

/**
 * Single eligibility seam for custody-safe legacy policy.
 * Identity is null `platformVersion` only — never inferred from JSON input shape.
 */
export function assertNonLegacyPlatformCapability(
  record: { platformVersion: string | null | undefined },
  capability: LegacyDeniedCapability
): void {
  if (!isLegacyPlatformVersion(record.platformVersion)) {
    return;
  }
  throw new AppError(legacyCapabilityDeniedMessage(capability), 400);
}
