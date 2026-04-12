import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { tokenService } from "@/server/services/token.service";
import { getServerUser } from "@/lib/utils/auth";
import { LandingPage } from "@/components/landing-page/landing-page";
import { HomeFaqJsonLd } from "@/components/seo/home-faq-json-ld";
import { BALLISTIK_X_HANDLE } from "@/lib/config/external-links";
import {
  absoluteUrl,
  HOME_PAGE_DESCRIPTION,
  HOME_PAGE_TITLE,
  OG_IMAGE_HEIGHT,
  OG_IMAGE_PATH,
  OG_IMAGE_WIDTH,
  SITE_BRAND_NAME,
} from "@/lib/config/site.config";

export const dynamic = "force-dynamic";

const homeOgTitle = `${HOME_PAGE_TITLE} | ${SITE_BRAND_NAME}`;

export const metadata: Metadata = {
  title: HOME_PAGE_TITLE,
  description: HOME_PAGE_DESCRIPTION,
  openGraph: {
    type: "website",
    url: absoluteUrl("/"),
    siteName: SITE_BRAND_NAME,
    title: homeOgTitle,
    description: HOME_PAGE_DESCRIPTION,
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
    title: homeOgTitle,
    description: HOME_PAGE_DESCRIPTION,
    images: [OG_IMAGE_PATH],
    site: BALLISTIK_X_HANDLE,
    creator: BALLISTIK_X_HANDLE,
  },
};

export default async function Page() {
  const user = await getServerUser();
  if (user) {
    const { items: tokens } = await tokenService.getUserTokens(user.id);

    if (tokens.length === 0) {
      redirect("/launch");
    }

    redirect(`/${tokens[0].publicKey}/dashboard`);
  }

  return (
    <>
      <HomeFaqJsonLd />
      <LandingPage />
    </>
  );
}
