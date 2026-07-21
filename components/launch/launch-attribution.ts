const LAUNCH_ATTRIBUTION_TEXT = "Launched with ballistik.app";

/** Description shown in Review/overview after attribution policy is applied. */
export function getLaunchAttributionDescription(
  description: string,
  removeAttribution: boolean
): string {
  const trimmed = description.trim();
  if (removeAttribution) {
    return trimmed || "-";
  }
  return trimmed
    ? `${trimmed}\n\n${LAUNCH_ATTRIBUTION_TEXT}`
    : LAUNCH_ATTRIBUTION_TEXT;
}
