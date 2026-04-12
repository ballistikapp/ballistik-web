import { LANDING_FAQ_ITEMS } from "@/lib/config/landing-faq";

/**
 * Homepage-only FAQPage JSON-LD. Must mirror visible FAQ copy in `LANDING_FAQ_ITEMS`.
 */
export function HomeFaqJsonLd() {
  const data = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: LANDING_FAQ_ITEMS.map((item) => ({
      "@type": "Question",
      name: item.question,
      acceptedAnswer: {
        "@type": "Answer",
        text: item.answer,
      },
    })),
  };

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
    />
  );
}
