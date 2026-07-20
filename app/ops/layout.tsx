import { notFound, redirect } from "next/navigation";
import { headers } from "next/headers";
import type { Metadata } from "next";
import Link from "next/link";
import { getServerUser } from "@/lib/utils/auth";
import { buildAuthRedirectPath } from "@/lib/utils/auth-redirect";
import { OpsSidebar } from "@/components/ops/ops-sidebar";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";

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
    <SidebarProvider
      style={
        {
          "--sidebar-width": "calc(var(--spacing) * 56)",
          "--header-height": "calc(var(--spacing) * 12)",
        } as React.CSSProperties
      }
    >
      <OpsSidebar variant="inset" />
      <SidebarInset>
        <header className="flex h-(--header-height) shrink-0 items-center gap-2 border-b transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-(--header-height)">
          <div className="flex w-full items-center gap-2 px-4 lg:px-6">
            <SidebarTrigger className="-ml-1" />
            <div className="flex min-w-0 flex-1 items-center gap-3">
              <span className="truncate text-sm font-semibold tracking-tight">
                Ops Console
              </span>
              <span className="text-muted-foreground hidden truncate text-xs sm:inline">
                Operator: {user.name}
              </span>
            </div>
            <Link
              href="/"
              className="text-muted-foreground hover:text-foreground shrink-0 text-xs underline-offset-4 hover:underline"
            >
              Back to app
            </Link>
          </div>
        </header>
        <div className="flex flex-1 flex-col">
          <div className="@container/main mx-auto flex w-full max-w-[1800px] flex-1 flex-col gap-2">
            <div className="flex min-h-0 flex-1 flex-col gap-4 px-4 py-4 md:gap-6 md:px-6 md:py-6 xl:px-8">
              {children}
            </div>
          </div>
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
