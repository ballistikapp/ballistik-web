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
                  className="text-base py-2 h-auto text-muted-foreground"
                  asChild={!isDisabled}
                  tooltip={item.title}
                  disabled={isDisabled}
                >
                  {isDisabled ? (
                    <div>
                      {item.icon && <item.icon className="size-10" />}
                      <span>{item.title}</span>
                    </div>
                  ) : (
                    <Link href={href}>
                      {item.icon && <item.icon className="size-10" />}
                      <span>{item.title}</span>
                    </Link>
                  )}
                </SidebarMenuButton>
              </SidebarMenuItem>
            );
          })}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
});
