/**
 * Shared legacy Platform identity and custody-safe capability messaging.
 * Null Platform version marks legacy — never infer from JSON input shape.
 */

export type LegacyDeniedCapability =
  | "retry"
  | "clone"
  | "new buys"
  | "automation";

export function isLegacyPlatformVersion(
  platformVersion: string | null | undefined
): boolean {
  return platformVersion == null;
}

export function legacyCapabilityDeniedMessage(
  capability: LegacyDeniedCapability
): string {
  return `This ${capability} action is unavailable for legacy records. Viewing, exits, SOL reclaim, and key access still work.`;
}
