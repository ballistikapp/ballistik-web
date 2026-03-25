"use client";

import * as React from "react";
import { IconCreditCard } from "@tabler/icons-react";
import { trpc } from "@/lib/trpc/client";
import {
  buildAndManageRoutes,
  helpRoutes,
  NavMain,
  tokenWorkspaceRoutes,
} from "@/components/layout/sidebar/nav-main";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
} from "@/components/ui/sidebar";
import type { UserTokenItems } from "@/server/services/token.service";
import { useSelectedToken } from "@/hooks/use-selected-token";
import { TokenSwitcher } from "./token-switcher";

type Props = React.ComponentProps<typeof Sidebar> & {
  tokens: UserTokenItems;
};

export const AppSidebar = React.memo(function AppSidebar({ ...props }: Props) {
  const { selectedTokenPublicKey } = useSelectedToken();
  const effectiveTokenPublicKey =
    selectedTokenPublicKey ?? props.tokens[0]?.publicKey;
  const { data: currentUser } = trpc.auth.me.useQuery();
  const subscriptionOverviewQuery = trpc.billing.getSubscriptionOverview.useQuery(
    {},
    {
      enabled: Boolean(currentUser),
      retry: false,
    }
  );
  const resolvedPlan =
    subscriptionOverviewQuery.data?.plan ?? currentUser?.plan ?? null;
  const subscriptionPlanBadge =
    resolvedPlan === "PRO" ? "Pro" : resolvedPlan === "FREE" ? "Free" : undefined;
  const buildAndManageItems = React.useMemo(
    () => [
      ...buildAndManageRoutes,
      {
        title: "Subscription",
        url: "/account/subscription",
        icon: IconCreditCard,
        scope: "global" as const,
        badge: subscriptionPlanBadge,
      },
    ],
    [subscriptionPlanBadge]
  );

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
          items={buildAndManageItems}
          currentToken={effectiveTokenPublicKey}
          className="mt-6"
        />
        <NavMain title="Contact & Help" items={helpRoutes} className="mt-6" />
      </SidebarContent>
      <SidebarFooter className="pt-0">
        <p className="text-center text-2xl font-bold tracking-wide text-sidebar-foreground/80 md:text-3xl lg:text-4xl group-data-[collapsible=icon]:hidden">
          BALLISTIK
        </p>
      </SidebarFooter>
    </Sidebar>
  );
});
