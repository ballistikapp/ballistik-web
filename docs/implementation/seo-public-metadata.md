# Public SEO metadata (Ballistik)

## Canonical URL

Production marketing origin is **`https://ballistik.app`** (apex). Next.js `metadataBase`, Open Graph `og:url`, and absolute `og:image` URLs are derived from this default.

## Environment

Set **`NEXT_PUBLIC_SITE_URL`** when a non-production deploy (e.g. staging or preview) should emit metadata and social cards with a different origin. Value must be a full URL or host; it is normalized with `new URL()` in [`lib/config/site.config.ts`](../../lib/config/site.config.ts).

If unset, metadata falls back to `https://ballistik.app`.

## Where copy lives

The public marketing story for logged-out visitors is the **`/`** route ([`app/page.tsx`](../../app/page.tsx)), which renders [`components/landing-page/landing-page.tsx`](../../components/landing-page/landing-page.tsx). Default site-wide title/description and OG/Twitter defaults are on the root [`app/layout.tsx`](../../app/layout.tsx); the homepage overrides title and description for richer SEO.

Social preview images use **`/ballistik-opengraph.png`** (see `OG_IMAGE_*` in `site.config.ts`).

Official social profile URLs (X and Telegram) and the X handle for `twitter:site` / `twitter:creator` live in [`lib/config/external-links.ts`](../../lib/config/external-links.ts). [`components/seo/site-json-ld.tsx`](../../components/seo/site-json-ld.tsx) sets `Organization.sameAs` to those URLs.

**FAQ:** Questions and answers live in [`lib/config/landing-faq.ts`](../../lib/config/landing-faq.ts) and render in the `#faq` section on the landing page. Edit that file so visible copy and JSON-LD stay in sync.

## Homepage FAQ JSON-LD

When the homepage renders the landing (logged-out users without an automatic redirect), [`app/page.tsx`](../../app/page.tsx) also includes [`components/seo/home-faq-json-ld.tsx`](../../components/seo/home-faq-json-ld.tsx): a single `application/ld+json` document with **`FAQPage`** and **`Question`** / **`Answer`** entries built from `LANDING_FAQ_ITEMS`. Authenticated users who hit `/` redirect away before the FAQ is shown, so this script is only emitted when the landing is visible.

## JSON-LD (structured data)

The root [`app/layout.tsx`](../../app/layout.tsx) includes [`components/seo/site-json-ld.tsx`](../../components/seo/site-json-ld.tsx): a single `application/ld+json` graph with **`WebSite`**, **`Organization`**, and **`SoftwareApplication`**, using the same canonical origin as metadata.

**Geographic scope:** `Organization.areaServed` is set to a **`Place`** named **Worldwide** via [`JSON_LD_AREA_SERVED`](../../lib/config/site.config.ts) — appropriate for a global product **without** a physical business address. Do **not** add `LocalBusiness`, postal addresses, or fake coordinates. If the product later has **real** jurisdictional limits, replace `JSON_LD_AREA_SERVED` with explicit Schema.org **`Country`** entries (or an array of them) that match those limits—not analytics “top countries.”
