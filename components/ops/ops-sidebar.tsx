"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  IconCoins,
  IconLayoutDashboard,
  IconList,
  IconShare,
  IconUsers,
  IconWallet,
  type Icon,
} from "@tabler/icons-react";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";

const OPS_NAV: { title: string; href: string; icon: Icon }[] = [
  { title: "Overview", href: "/ops", icon: IconLayoutDashboard },
  { title: "Users", href: "/ops/users", icon: IconUsers },
  { title: "Marketers", href: "/ops/marketers", icon: IconShare },
  { title: "Wallets", href: "/ops/wallets", icon: IconWallet },
  { title: "Tokens", href: "/ops/tokens", icon: IconCoins },
  { title: "Launches", href: "/ops/launches", icon: IconList },
];

function isActivePath(pathname: string, href: string) {
  if (href === "/ops") {
    return pathname === "/ops";
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function OpsSidebar({
  ...props
}: React.ComponentProps<typeof Sidebar>) {
  const pathname = usePathname();

  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild tooltip="Ops Console">
              <Link href="/ops">
                <div className="bg-sidebar-primary text-sidebar-primary-foreground flex aspect-square size-8 items-center justify-center rounded-lg text-xs font-semibold">
                  OP
                </div>
                <div className="grid min-w-0 flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-semibold">Ops Console</span>
                  <span className="text-muted-foreground truncate text-xs">
                    Internal tools
                  </span>
                </div>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Navigation</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {OPS_NAV.map((item) => {
                const active = isActivePath(pathname, item.href);
                return (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton
                      asChild
                      isActive={active}
                      tooltip={item.title}
                    >
                      <Link href={item.href}>
                        <item.icon />
                        <span>{item.title}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
}
