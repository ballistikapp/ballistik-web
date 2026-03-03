import Link from "next/link";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import type { CSSProperties } from "react";
import { tokenService } from "@/server/services/token.service";
import { getServerUser } from "@/lib/utils/auth";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Home",
};

export default async function Page() {
  const glowRgb = "59,130,246";
  const defaultGlowLayers = [
    { x: 0, y: 0, blur: 7, spread: 1, alpha: 0.58 },
    { x: -4, y: 0, blur: 62, spread: 26, alpha: 0.17 },
    { x: -24, y: 0, blur: 250, spread: 130, alpha: 0.075 },
  ];
  const hoverGlowLayers = [
    { x: 0, y: 0, blur: 8, spread: 1, alpha: 0.74 },
    { x: -2, y: 0, blur: 34, spread: 8, alpha: 0.33 },
    { x: -14, y: 0, blur: 155, spread: 52, alpha: 0.18 },
    { x: -42, y: 0, blur: 340, spread: 150, alpha: 0.095 },
    { x: -110, y: 0, blur: 740, spread: 320, alpha: 0.045 },
  ];
  const buildGlow = (
    layers: Array<{
      x?: number;
      y?: number;
      blur: number;
      spread?: number;
      alpha: number;
    }>
  ) =>
    layers
      .map(
        ({ x = 0, y = 0, blur, spread = 0, alpha }) =>
          `${x}px ${y}px ${blur}px ${spread}px rgba(${glowRgb},${alpha})`
      )
      .join(", ");

  const sourceGlow = buildGlow(hoverGlowLayers);
  const defaultGlow = buildGlow(defaultGlowLayers);
  const glowStyle = {
    "--glow-default": defaultGlow,
    "--glow-hover": sourceGlow,
  } as CSSProperties;

  const user = await getServerUser();
  if (user) {
    const { items: tokens } = await tokenService.getUserTokens(user.id);

    if (tokens.length === 0) {
      redirect("/launch");
    }

    redirect(`/${tokens[0].publicKey}/dashboard`);
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-6 md:px-10">
        <p className="text-3xl font-bold text-foreground">BALLISTIK</p>
        <Link
          href="/auth"
          className="group rounded-lg flex items-center gap-8 border border-white/10 px-2.5 py-1.5 font-medium text-foreground transition-all duration-700 ease-[cubic-bezier(0.22,1,0.36,1)] hover:border-white/25"
        >
          <span>GO TO APP</span>
          <div
            className="h-4 w-4 rounded-sm bg-blue-500 shadow-[var(--glow-default)] transition-[box-shadow] duration-700 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:shadow-[var(--glow-hover)]"
            style={glowStyle}
          />
        </Link>
      </header>

      <main className="mx-auto flex min-h-[calc(100vh-88px)] w-full max-w-6xl flex-col items-center justify-center px-6 py-12 text-center md:px-10"></main>
    </div>
  );
}
