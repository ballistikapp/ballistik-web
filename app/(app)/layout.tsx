import { redirect } from "next/navigation";
import { headers } from "next/headers";
import type { Metadata } from "next";
import { AppSidebar } from "@/components/layout/sidebar/app-sidebar";
import { SiteHeader } from "@/components/layout/site-header";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { tokenService } from "@/server/services/token.service";
import { TokenProvider } from "@/contexts/token-context";
import { getServerUser } from "@/lib/utils/auth";
import { buildAuthRedirectPath } from "@/lib/utils/auth-redirect";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: {
    default: "Ballistik",
    template: "%s | Ballistik",
  },
};

export default async function MainLayout({
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
      : "/";
    redirect(buildAuthRedirectPath(returnTo));
  }

  const { items: tokens } = await tokenService.getUserTokens(user.id);
  return (
    <TokenProvider>
      <SidebarProvider
        style={
          {
            "--sidebar-width": "calc(var(--spacing) * 62)",
            "--header-height": "calc(var(--spacing) * 12)",
          } as React.CSSProperties
        }
      >
        <AppSidebar variant="inset" tokens={tokens} />
        <SidebarInset>
          <SiteHeader />
          <div className="flex flex-1 flex-col">
            <div className="@container/main mx-auto flex w-full max-w-[1800px] flex-1 flex-col gap-2">
              <div className="flex min-h-0 flex-1 flex-col gap-4 px-4 py-4 md:gap-6 md:px-6 md:py-6 xl:px-8">
                {children}
              </div>
            </div>
          </div>
        </SidebarInset>
      </SidebarProvider>
    </TokenProvider>
  );
}
