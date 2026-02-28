import type { Metadata } from "next";
import { Geist_Mono } from "next/font/google";
import localFont from "next/font/local";
import "./globals.css";
import { TRPCProvider } from "@/lib/trpc/provider";
import { NuqsAdapter } from "nuqs/adapters/next/app";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "sonner";
import NextTopLoader from "nextjs-toploader";
import { ClickyAnalytics } from "@/components/analytics/clicky-analytics";
import { TokenProvider } from "@/contexts/token-context";

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

export const metadata: Metadata = {
  title: "BALLISTIK",
  description: "BALLISTIK | Solana Launch Platform",
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
      </body>
    </html>
  );
}
