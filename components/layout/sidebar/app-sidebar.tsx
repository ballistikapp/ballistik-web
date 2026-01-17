"use client";

import * as React from "react";
import { useQueryState } from "nuqs";
import {
  IconListDetails,
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
import { tokenQueryParser } from "@/lib/utils/token-query";

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

const SELECTED_TOKEN_KEY = "selected-token-public-key";

export const AppSidebar = React.memo(function AppSidebar({ ...props }: Props) {
  const [currentTokenPublicKey] = useQueryState("token", tokenQueryParser);

  const [storedTokenPublicKey] = React.useState<string | null>(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem(SELECTED_TOKEN_KEY);
    }
    return null;
  });

  const effectiveToken = React.useMemo(
    () => currentTokenPublicKey || storedTokenPublicKey || undefined,
    [currentTokenPublicKey, storedTokenPublicKey]
  );

  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader>
        <TokenSwitcher tokens={props.tokens} />
      </SidebarHeader>
      <SidebarContent>
        <NavMain
          items={data.tokenSpecificRoutes}
          currentToken={effectiveToken}
        />
        <NavSecondary items={data.navSecondary} className="mt-auto" />
      </SidebarContent>
    </Sidebar>
  );
});
