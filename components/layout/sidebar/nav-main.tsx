"use client";

import * as React from "react";
import {
  type Icon,
  IconBolt,
  IconLayoutDashboard,
  IconListDetails,
  IconRocket,
  IconUserCircle,
  IconWallet,
} from "@tabler/icons-react";

import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import Link from "next/link";
import { cn } from "@/lib/utils";

export type NavMainItem = {
  title: string;
  url: string;
  icon?: Icon;
  scope?: "token" | "global";
};

export const tokenWorkspaceRoutes: NavMainItem[] = [
  {
    title: "Dashboard",
    url: "/dashboard",
    icon: IconLayoutDashboard,
    scope: "token",
  },
  {
    title: "Holdings",
    url: "/holdings",
    icon: IconListDetails,
    scope: "token",
  },
  {
    title: "Transactions",
    url: "/transactions",
    icon: IconListDetails,
    scope: "token",
  },
  {
    title: "Wallets",
    url: "/wallets",
    icon: IconWallet,
    scope: "token",
  },
  {
    title: "Volume Bot",
    url: "/volume-bot",
    icon: IconBolt,
    scope: "token",
  },
];

export const buildAndManageRoutes: NavMainItem[] = [
  {
    title: "Launch",
    url: "/launch",
    icon: IconRocket,
    scope: "global",
  },
  {
    title: "My Tokens",
    url: "/tokens",
    icon: IconListDetails,
    scope: "global",
  },
  {
    title: "Account",
    url: "/account",
    icon: IconUserCircle,
    scope: "global",
  },
];

export const NavMain = React.memo(function NavMain({
  title,
  items,
  currentToken,
  ...props
}: {
  title?: string;
  items: NavMainItem[];
  currentToken?: string;
} & React.ComponentPropsWithoutRef<typeof SidebarGroup>) {
  return (
    <SidebarGroup {...props}>
      {title ? (
        <SidebarGroupLabel className="px-2 pb-1 text-[10px] uppercase tracking-[0.12em] text-muted-foreground/45">
          {title}
        </SidebarGroupLabel>
      ) : null}
      <SidebarGroupContent className="flex flex-col">
        <SidebarMenu className="gap-1">
          {items.map((item) => {
            const isTokenScoped = item.scope !== "global";
            const href =
              isTokenScoped && currentToken
                ? `/${currentToken}${item.url}`
                : item.url;
            const isDisabled = isTokenScoped && !currentToken;

            return (
              <SidebarMenuItem key={item.title}>
                <SidebarMenuButton
                  className={cn(
                    "text-base py-2 h-auto text-muted-foreground",
                    isDisabled && "pointer-events-none opacity-50"
                  )}
                  asChild={true}
                  tooltip={item.title}
                  disabled={isDisabled}
                >
                  <Link href={href}>
                    {item.icon && <item.icon className="size-10" />}
                    <span>{item.title}</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            );
          })}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
});
