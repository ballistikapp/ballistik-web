"use client";

import * as React from "react";
import {
  type Icon,
  IconArrowsRightLeft,
  IconBrandTelegram,
  IconBrandX,
  IconCoins,
  IconExternalLink,
  IconHistory,
  IconLayoutDashboard,
  IconList,
  IconPlus,
  IconRobot,
  IconWallet,
} from "@tabler/icons-react";

import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenuBadge,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  BALLISTIK_TELEGRAM_URL,
  BALLISTIK_X_URL,
} from "@/lib/config/external-links";
import Link from "next/link";
import { cn } from "@/lib/utils";

export type NavMainItem = {
  title: string;
  url: string;
  icon?: Icon;
  iconClassName?: string;
  scope?: "token" | "global";
  external?: boolean;
  badge?: string;
  badgeTooltip?: string;
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
    icon: IconCoins,
    scope: "token",
  },
  {
    title: "Wallets",
    url: "/wallets",
    icon: IconWallet,
    scope: "token",
  },
  {
    title: "Transactions",
    url: "/transactions",
    icon: IconArrowsRightLeft,
    scope: "token",
  },
  {
    title: "Volume Bot",
    url: "/volume-bot",
    icon: IconRobot,
    scope: "token",
  },
  {
    title: "Launch New Token",
    url: "/launch",
    icon: IconPlus,
    iconClassName: "text-primary",
    scope: "global",
  },
];

export const accountRoutes: NavMainItem[] = [
  {
    title: "Main Wallet",
    url: "/account",
    icon: IconWallet,
    scope: "global",
  },
  {
    title: "Launches",
    url: "/launches",
    icon: IconList,
    scope: "global",
  },
  {
    title: "History",
    url: "/history",
    icon: IconHistory,
    scope: "global",
  },
];

export const helpRoutes: NavMainItem[] = [
  {
    title: "Telegram",
    url: BALLISTIK_TELEGRAM_URL,
    icon: IconBrandTelegram,
    scope: "global",
    external: true,
  },
  {
    title: "X",
    url: BALLISTIK_X_URL,
    icon: IconBrandX,
    scope: "global",
    external: true,
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
                    item.badge && "pr-14",
                    isDisabled && "pointer-events-none opacity-50"
                  )}
                  asChild={true}
                  tooltip={item.title}
                  disabled={isDisabled}
                >
                  <Link
                    href={href}
                    target={item.external ? "_blank" : undefined}
                    rel={item.external ? "noreferrer" : undefined}
                  >
                    {item.icon && (
                      <item.icon
                        className={cn("size-10 shrink-0", item.iconClassName)}
                      />
                    )}
                    <span className="min-w-0 flex-1 truncate">
                      {item.title}
                    </span>
                    {item.badge ? (
                      item.badgeTooltip ? (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <SidebarMenuBadge className="pointer-events-auto right-2 gap-1 rounded-md bg-sidebar-accent/60 px-2 text-[10px] font-semibold tracking-[0.08em] text-primary">
                              <span className="size-1 rounded-full bg-primary" />
                              <span>{item.badge}</span>
                            </SidebarMenuBadge>
                          </TooltipTrigger>
                          <TooltipContent side="right">
                            {item.badgeTooltip}
                          </TooltipContent>
                        </Tooltip>
                      ) : (
                        <SidebarMenuBadge className="right-2 rounded-full border border-sidebar-border/70 bg-sidebar-accent/60 px-2 text-[10px] font-semibold tracking-[0.08em]">
                          {item.badge}
                        </SidebarMenuBadge>
                      )
                    ) : null}
                    {item.external ? (
                      <IconExternalLink className="ml-auto size-3.5 shrink-0 opacity-60 group-data-[collapsible=icon]:hidden" />
                    ) : null}
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
