import { redirect } from "next/navigation";
import { tokenService } from "@/server/services/token.service";
import { getServerUser } from "@/lib/utils/auth";

export const dynamic = "force-dynamic";

export default async function Page() {
  const user = await getServerUser();
  if (!user) {
    redirect("/auth");
  }

  const tokens = await tokenService.getUserTokens(user.id);

  if (tokens.length === 0) {
    return redirect("/launch");
  }

  return redirect(`/${tokens[0].publicKey}/dashboard`);
}
