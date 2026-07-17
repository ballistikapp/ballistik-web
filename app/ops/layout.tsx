import { notFound, redirect } from "next/navigation";
import { headers } from "next/headers";
import type { Metadata } from "next";
import Link from "next/link";
import { getServerUser } from "@/lib/utils/auth";
import { buildAuthRedirectPath } from "@/lib/utils/auth-redirect";
import { OpsSidebar } from "@/components/ops/ops-sidebar";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: {
    default: "Ops Console",
    template: "%s | Ops Console",
  },
};

export default async function OpsLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const user = await getServerUser();
  if (!user) {
    const requestHeaders = await headers();
    const invokePath = requestHeaders.get("x-invoke-path");
    const invokeQuery = requestHeaders.get("x-invoke-query");
    const returnTo = invokePath
      ? `${invokePath}${invokeQuery ? `?${invokeQuery}` : ""}`
      : "/ops";
    redirect(buildAuthRedirectPath(returnTo));
  }

  if (!user.isOperator) {
    notFound();
  }

  return (
    <div className="bg-background text-foreground min-h-screen">
      <header className="border-border border-b">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-4 py-3 md:px-6">
          <div className="flex items-center gap-4">
            <Link href="/ops" className="text-sm font-semibold tracking-tight">
              Ops Console
            </Link>
            <span className="text-muted-foreground text-xs">
              Operator: {user.name}
            </span>
          </div>
          <Link
            href="/"
            className="text-muted-foreground hover:text-foreground text-xs underline-offset-4 hover:underline"
          >
            Back to app
          </Link>
        </div>
      </header>
      <div className="mx-auto flex w-full max-w-6xl gap-6 px-4 py-6 md:gap-8 md:px-6 md:py-8">
        <aside className="border-border w-44 shrink-0 border-r pr-4 md:w-52 md:pr-6">
          <OpsSidebar />
        </aside>
        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </div>
  );
}
