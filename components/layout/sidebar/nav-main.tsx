"use client";

import * as React from "react";
import { type Icon } from "@tabler/icons-react";

import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import Link from "next/link";
import { cn } from "@/lib/utils";

export const NavMain = React.memo(function NavMain({
  items,
  currentToken,
}: {
  items: {
    title: string;
    url: string;
    icon?: Icon;
  }[];
  currentToken?: string;
}) {
  return (
    <SidebarGroup>
      <SidebarGroupContent className="flex flex-col">
        <SidebarMenu className="gap-1 pt-6">
          {items.map((item) => {
            const href = currentToken
              ? `/${currentToken}${item.url}`
              : item.url;
            const isDisabled = !currentToken;

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
