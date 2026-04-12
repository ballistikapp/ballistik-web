/**
 * Public site URL and SEO-related defaults for Ballistik (ballistik.app).
 * Used by root layout metadata and the logged-out landing route.
 */

import { WEEKLY_PRO_PRICE_SOL } from "@/lib/config/subscription.config";

const SITE_ORIGIN_DEFAULT = "https://ballistik.app";

/**
 * Canonical origin for metadataBase, og:url, and absolute asset URLs.
 * Override in staging/preview via NEXT_PUBLIC_SITE_URL (e.g. https://staging.example.com).
 */
export function getSiteOrigin(): string {
  const raw = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (!raw) {
    return SITE_ORIGIN_DEFAULT;
  }
  try {
    const url = new URL(raw.startsWith("http") ? raw : `https://${raw}`);
    return url.origin;
  } catch {
    return SITE_ORIGIN_DEFAULT;
  }
}

/** Path must start with `/`. */
export function absoluteUrl(path: string): string {
  const base = getSiteOrigin();
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return `${base}${normalized}`;
}

export const SITE_BRAND_NAME = "Ballistik";

/**
 * Logo-style wordmarks: render ALL CAPS visually while keeping {@link SITE_BRAND_NAME} in the DOM
 * (SEO + a11y; avoids duplicating "BALLISTIK" vs "Ballistik" strings).
 */
export const BRAND_WORDMARK_CLASSNAME = "uppercase tracking-wide";

/** Default <meta name="description"> when a route does not override. */
export const DEFAULT_SITE_DESCRIPTION =
  "Launch and manage Solana tokens on pump.fun with Jito bundles, a volume bot, and operational wallets. Free tier with usage fees; Pro subscription for premium limits and zero platform fees on supported flows.";

/** Homepage-specific title segment (becomes `{title} | Ballistik` via template). */
export const HOME_PAGE_TITLE =
  "Solana token launch, volume bots & Jito bundles";

/**
 * Homepage meta description (~155 chars): keywords + pricing hint.
 */
export const HOME_PAGE_DESCRIPTION = `Ballistik: Solana pump.fun launches with Jito bundles, volume bot automation, and wallet ops. Free with usage fees; Pro (${WEEKLY_PRO_PRICE_SOL} SOL/week) adds premium limits and features.`;

export const OG_IMAGE_PATH = "/ballistik-opengraph.png";
export const OG_IMAGE_WIDTH = 1200;
export const OG_IMAGE_HEIGHT = 630;

/**
 * Schema.org `areaServed` for JSON-LD (`Organization`). Global product; no physical address.
 * Replace with an array of `{ "@type": "Country", name: "..." }` if you add jurisdictional restrictions.
 */
export const JSON_LD_AREA_SERVED = {
  "@type": "Place" as const,
  name: "Worldwide",
};
