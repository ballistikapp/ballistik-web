import {
  BALLISTIK_TELEGRAM_URL,
  BALLISTIK_X_URL,
} from "@/lib/config/external-links";
import {
  absoluteUrl,
  DEFAULT_SITE_DESCRIPTION,
  getSiteOrigin,
  JSON_LD_AREA_SERVED,
  SITE_BRAND_NAME,
} from "@/lib/config/site.config";

/**
 * Site-wide JSON-LD: WebSite, Organization (with worldwide `areaServed`), SoftwareApplication.
 * Renders in root layout; uses canonical origin from `getSiteOrigin()`.
 */
export function SiteJsonLd() {
  const origin = getSiteOrigin();
  const idOrganization = `${origin}/#organization`;
  const idWebsite = `${origin}/#website`;
  const idSoftware = `${origin}/#software`;

  const graph = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "@id": idOrganization,
        name: SITE_BRAND_NAME,
        url: origin,
        logo: {
          "@type": "ImageObject",
          url: absoluteUrl("/favicon.png"),
        },
        areaServed: JSON_LD_AREA_SERVED,
        sameAs: [BALLISTIK_X_URL, BALLISTIK_TELEGRAM_URL],
      },
      {
        "@type": "WebSite",
        "@id": idWebsite,
        url: origin,
        name: SITE_BRAND_NAME,
        description: DEFAULT_SITE_DESCRIPTION,
        publisher: { "@id": idOrganization },
      },
      {
        "@type": "SoftwareApplication",
        "@id": idSoftware,
        name: SITE_BRAND_NAME,
        applicationCategory: "FinanceApplication",
        operatingSystem: "Web",
        url: origin,
        description: DEFAULT_SITE_DESCRIPTION,
        provider: { "@id": idOrganization },
      },
    ],
  };

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(graph) }}
    />
  );
}
