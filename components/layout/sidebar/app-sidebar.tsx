"use client";

import * as React from "react";
import {
  IconListDetails,
  IconBolt,
  IconRocket,
  IconWallet,
  IconLayoutDashboard,
} from "@tabler/icons-react";

import { NavMain } from "@/components/layout/sidebar/nav-main";
import { NavSecondary } from "@/components/layout/sidebar/nav-secondary";
import {
  Sidebar,
  SidebarContent,
  SidebarHeader,
} from "@/components/ui/sidebar";
import { TokenSwitcher } from "./token-switcher";
import { UserTokensOutput } from "@/server/services/token.service";
import { useSelectedToken } from "@/hooks/use-selected-token";

const data = {
  tokenSpecificRoutes: [
    {
      title: "Dashboard",
      url: "/dashboard",
      icon: IconLayoutDashboard,
    },
    {
      title: "Holdings",
      url: "/holdings",
      icon: IconListDetails,
    },
    {
      title: "Transactions",
      url: "/transactions",
      icon: IconListDetails,
    },
    {
      title: "Volume Bot",
      url: "/volume-bot",
      icon: IconBolt,
    },
    {
      title: "Wallets",
      url: "/wallets",
      icon: IconWallet,
    },
  ],
  navSecondary: [
    {
      title: "Launch Token",
      url: "/launch",
      icon: IconRocket,
    },
  ],
};

type Props = React.ComponentProps<typeof Sidebar> & {
  tokens: UserTokensOutput;
};

export const AppSidebar = React.memo(function AppSidebar({ ...props }: Props) {
  const { selectedTokenPublicKey } = useSelectedToken();

  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader>
        <TokenSwitcher tokens={props.tokens} />
      </SidebarHeader>
      <SidebarContent>
        <NavMain
          items={data.tokenSpecificRoutes}
          currentToken={selectedTokenPublicKey || undefined}
        />
        <NavSecondary items={data.navSecondary} className="mt-auto" />
      </SidebarContent>
    </Sidebar>
  );
});
