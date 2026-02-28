"use client";

import * as React from "react";
import {
  buildAndManageRoutes,
  NavMain,
  tokenWorkspaceRoutes,
} from "@/components/layout/sidebar/nav-main";
import {
  Sidebar,
  SidebarContent,
  SidebarHeader,
} from "@/components/ui/sidebar";
import { TokenSwitcher } from "./token-switcher";
import type { UserTokenItems } from "@/server/services/token.service";
import { useSelectedToken } from "@/hooks/use-selected-token";

type Props = React.ComponentProps<typeof Sidebar> & {
  tokens: UserTokenItems;
};

export const AppSidebar = React.memo(function AppSidebar({ ...props }: Props) {
  const { selectedTokenPublicKey } = useSelectedToken();
  const effectiveTokenPublicKey =
    selectedTokenPublicKey ?? props.tokens[0]?.publicKey;

  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader>
        <TokenSwitcher tokens={props.tokens} />
      </SidebarHeader>
      <SidebarContent>
        <NavMain
          title="Token Workspace"
          items={tokenWorkspaceRoutes}
          currentToken={effectiveTokenPublicKey}
        />
        <NavMain
          title="Build & Manage"
          items={buildAndManageRoutes}
          currentToken={effectiveTokenPublicKey}
          className="mt-6"
        />
      </SidebarContent>
    </Sidebar>
  );
});
