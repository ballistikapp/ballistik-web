import type { Metadata } from "next";
import { Geist_Mono } from "next/font/google";
import localFont from "next/font/local";
import "./globals.css";
import { BALLISTIK_X_HANDLE } from "@/lib/config/external-links";
import {
  DEFAULT_SITE_DESCRIPTION,
  getSiteOrigin,
  OG_IMAGE_HEIGHT,
  OG_IMAGE_PATH,
  OG_IMAGE_WIDTH,
  SITE_BRAND_NAME,
} from "@/lib/config/site.config";
import { TRPCProvider } from "@/lib/trpc/provider";
import { NuqsAdapter } from "nuqs/adapters/next/app";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "sonner";
import NextTopLoader from "nextjs-toploader";
import { ClickyAnalytics } from "@/components/analytics/clicky-analytics";
import { GoogleAnalytics } from "@/components/analytics/google-analytics";
import { TokenProvider } from "@/contexts/token-context";
import { SiteJsonLd } from "@/components/seo/site-json-ld";

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const clash = localFont({
  variable: "--font-clash",
  src: [
    {
      path: "../public/fonts/clash/ClashGrotesk-Extralight.woff2",
      weight: "200",
      style: "normal",
    },
    {
      path: "../public/fonts/clash/ClashGrotesk-Light.woff2",
      weight: "300",
      style: "normal",
    },
    {
      path: "../public/fonts/clash/ClashGrotesk-Regular.woff2",
      weight: "400",
      style: "normal",
    },
    {
      path: "../public/fonts/clash/ClashGrotesk-Medium.woff2",
      weight: "500",
      style: "normal",
    },
    {
      path: "../public/fonts/clash/ClashGrotesk-Semibold.woff2",
      weight: "600",
      style: "normal",
    },
    {
      path: "../public/fonts/clash/ClashGrotesk-Bold.woff2",
      weight: "700",
      style: "normal",
    },
  ],
});

const siteOrigin = getSiteOrigin();

export const metadata: Metadata = {
  metadataBase: new URL(siteOrigin),
  title: {
    default: SITE_BRAND_NAME,
    template: `%s | ${SITE_BRAND_NAME}`,
  },
  description: DEFAULT_SITE_DESCRIPTION,
  icons: {
    icon: "/favicon.png",
  },
  openGraph: {
    type: "website",
    locale: "en",
    url: siteOrigin,
    siteName: SITE_BRAND_NAME,
    title: SITE_BRAND_NAME,
    description: DEFAULT_SITE_DESCRIPTION,
    images: [
      {
        url: OG_IMAGE_PATH,
        width: OG_IMAGE_WIDTH,
        height: OG_IMAGE_HEIGHT,
        alt: `${SITE_BRAND_NAME} — Solana token launch platform`,
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: SITE_BRAND_NAME,
    description: DEFAULT_SITE_DESCRIPTION,
    images: [OG_IMAGE_PATH],
    site: BALLISTIK_X_HANDLE,
    creator: BALLISTIK_X_HANDLE,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`dark ${clash.className} ${clash.variable} ${geistMono.variable} antialiased`}
      >
        <SiteJsonLd />
        <NuqsAdapter>
          <TooltipProvider delayDuration={0}>
            <TRPCProvider>
              <TokenProvider>
                <NextTopLoader color="#333" height={5} showSpinner={false} />
                {children}
                <Toaster
                  richColors
                  closeButton
                  position="bottom-center"
                  theme="dark"
                  toastOptions={{
                    className: "shadow-[0_8px_24px_rgba(0,0,0,0.25)]",
                  }}
                />
              </TokenProvider>
            </TRPCProvider>
          </TooltipProvider>
        </NuqsAdapter>
        <ClickyAnalytics />
        <GoogleAnalytics />
      </body>
    </html>
  );
}
