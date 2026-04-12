"use client";

import Image from "next/image";
import { GalleryVerticalEnd, ChevronsUpDown } from "lucide-react";
import { IconCreditCard, IconDotsVertical, IconWallet } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Sidebar,
  SidebarContent,
  SidebarHeader,
  SidebarInset,
  SidebarMenuButton,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import {
  NavMain,
  accountRoutes,
  helpRoutes,
  tokenWorkspaceRoutes,
} from "@/components/layout/sidebar/nav-main";
import { marketingMockDashboard } from "@/lib/config/marketing-mock-dashboard.config";

const accountItems = [
  ...accountRoutes,
  {
    title: "Subscription",
    url: "/account/subscription",
    icon: IconCreditCard,
    scope: "global" as const,
    badge: "Pro",
  },
];

export function MarketingMockDashboardShell({
  children,
}: {
  children: React.ReactNode;
}) {
  const token = marketingMockDashboard.tokenDisplay;
  const { name: headerWalletName, balanceSol } =
    marketingMockDashboard.headerWallet;

  return (
    <SidebarProvider
      style={
        {
          "--sidebar-width": "calc(var(--spacing) * 62)",
          "--header-height": "calc(var(--spacing) * 12)",
        } as React.CSSProperties
      }
    >
      <div className="pointer-events-none select-none">
        <Sidebar collapsible="icon" variant="inset">
          <SidebarHeader>
            <SidebarMenuButton
              size="lg"
              disabled
              className="py-6 opacity-100 cursor-default data-[disabled]:opacity-100"
            >
              <div className="flex aspect-square size-10 items-center justify-center rounded-xl overflow-hidden shrink-0">
                {token.imageUrl ? (
                  <Image
                    src={token.imageUrl}
                    alt={token.name}
                    className="h-full w-full object-cover"
                    width={40}
                    height={40}
                  />
                ) : (
                  <GalleryVerticalEnd className="size-5" />
                )}
              </div>
              <div className="flex flex-col gap-1 leading-none min-w-0 flex-1">
                <span className="font-semibold text-sm truncate">
                  {token.name}
                </span>
                <Badge variant="secondary" className="text-xs font-mono w-fit">
                  ${token.symbol}
                </Badge>
              </div>
              <ChevronsUpDown className="ml-auto shrink-0 opacity-50" />
            </SidebarMenuButton>
          </SidebarHeader>
          <SidebarContent>
            <NavMain
              title="Token Workspace"
              items={tokenWorkspaceRoutes}
              currentToken={marketingMockDashboard.tokenPublicKey}
            />
            <NavMain
              title="Account"
              items={accountItems}
              currentToken={marketingMockDashboard.tokenPublicKey}
              className="mt-auto pt-6"
            />
            <NavMain
              title="Contact & Help"
              items={helpRoutes}
              className="pt-2"
            />
          </SidebarContent>
        </Sidebar>
      </div>
      <SidebarInset>
        <header className="pointer-events-none select-none flex h-(--header-height) shrink-0 items-center gap-2 border-b transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-(--header-height)">
          <div className="flex w-full items-center gap-1 px-4 lg:gap-2 lg:px-6 lg:pr-0">
            <SidebarTrigger className="-ml-1" />
            <div className="ml-auto flex items-center gap-2">
              <Button
                variant="ghost"
                size="default"
                className="h-12 gap-3 px-3 rounded-xl hover:bg-muted/10"
                disabled
              >
                <span className="flex size-8 items-center justify-center rounded-full bg-muted">
                  <IconWallet className="size-4" />
                </span>
                <span className="hidden sm:flex flex-col items-start leading-none">
                  <span className="text-sm font-medium">{headerWalletName}</span>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {balanceSol.toFixed(4)} SOL
                  </span>
                </span>
                <IconDotsVertical className="size-4 ml-4 text-muted-foreground" />
              </Button>
            </div>
          </div>
        </header>
        <div className="flex flex-1 flex-col">
          <div className="@container/main mx-auto flex w-full max-w-[1800px] flex-1 flex-col gap-2">
            <div className="flex flex-col gap-4 px-4 py-4 md:gap-6 md:px-6 md:py-6 xl:px-8">
              {children}
            </div>
          </div>
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
