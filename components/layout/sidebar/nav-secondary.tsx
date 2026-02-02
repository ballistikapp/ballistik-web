"use client";

import * as React from "react";
import { type Icon } from "@tabler/icons-react";
import { CoinsIcon } from "lucide-react";
import Link from "next/link";

import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";

export const NavSecondary = React.memo(function NavSecondary({
  items,
  ...props
}: {
  items: {
    title: string;
    url: string;
    icon: Icon;
  }[];
} & React.ComponentPropsWithoutRef<typeof SidebarGroup>) {
  return (
    <SidebarGroup {...props}>
      <SidebarGroupContent>
        <SidebarMenu>
          <SidebarMenuItem>
            <div className="flex pl-2 pb-2 font-bold tracking-tighter text-5xl">
              <CoinsIcon className="size-[52px] text-primary mr-2 -mt-1.5" />
              <span className="text-muted-foreground/70">sol</span>
              <span className="text-muted-foreground/40">labs</span>
            </div>
          </SidebarMenuItem>
          {/* {items.map((item) => (
            <SidebarMenuItem key={item.title}>
              <SidebarMenuButton asChild tooltip={item.title}>
                <Link href={item.url}>
                  <item.icon />
                  <span>{item.title}</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))} */}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
});
