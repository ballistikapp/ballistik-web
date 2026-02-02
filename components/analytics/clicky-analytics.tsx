"use client";

import Script from "next/script";

export function ClickyAnalytics() {
  const siteId = process.env.NEXT_PUBLIC_CLICKY_SITE_ID;

  if (!siteId) {
    console.warn("Clicky site ID not configured");
    return null;
  }

  return (
    <Script
      id="clicky-analytics"
      strategy="afterInteractive"
      data-id={siteId}
      src="//static.getclicky.com/js"
    />
  );
}
