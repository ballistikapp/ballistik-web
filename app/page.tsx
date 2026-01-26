import { redirect } from "next/navigation";
import { tokenService } from "@/server/services/token.service";

export const dynamic = "force-dynamic";

export default async function Page() {
  // const tokens = await tokenService.getUserTokens();
  // if (tokens.length === 0) {
  //   return redirect("/launch");
  // }
  // return redirect(`/dashboard?token=${tokens[0].publicKey}`);
}
