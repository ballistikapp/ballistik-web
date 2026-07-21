/**
 * Funnel-facing Platform choices. Only PUMPFUN is submittable until SPL exists.
 * EVM is intentionally absent.
 */
export const FUNNEL_PLATFORM_OPTIONS = [
  {
    id: "PUMPFUN",
    label: "pump.fun",
    available: true,
    logoSrc: "/logos/pumpfun.svg",
    logoAlt: "pump.fun",
  },
  {
    id: "SPL",
    label: "SPL",
    available: false,
    comingSoon: true,
    logoSrc: "/logos/solana.svg",
    logoAlt: "Solana",
  },
] as const;

export type FunnelPlatformOptionId =
  (typeof FUNNEL_PLATFORM_OPTIONS)[number]["id"];

/** Platforms the funnel may submit to the backend. */
export type SubmittableFunnelPlatform = "PUMPFUN";

export function isSubmittableFunnelPlatform(
  platform: string
): platform is SubmittableFunnelPlatform {
  return platform === "PUMPFUN";
}

export function getAvailableFunnelPlatforms() {
  return FUNNEL_PLATFORM_OPTIONS.filter((option) => option.available);
}

export function getComingSoonFunnelPlatforms() {
  return FUNNEL_PLATFORM_OPTIONS.filter((option) => !option.available);
}
