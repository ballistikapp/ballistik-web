import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { tokenService } from "@/server/services/token.service";
import { getServerUser } from "@/lib/utils/auth";
import { LandingPage } from "@/components/landing-page/landing-page";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Home",
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

  return <LandingPage />;
}
