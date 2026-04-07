"use client";

import * as React from "react";
import { IconCreditCard } from "@tabler/icons-react";
import { trpc } from "@/lib/trpc/client";
import {
  accountRoutes,
  helpRoutes,
  NavMain,
  tokenWorkspaceRoutes,
} from "@/components/layout/sidebar/nav-main";
import {
  Sidebar,
  SidebarContent,
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
  const sidebarCountsQuery = trpc.token.getSidebarCounts.useQuery(
    { publicKey: effectiveTokenPublicKey ?? "" },
    {
      enabled: Boolean(effectiveTokenPublicKey),
    }
  );
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
  const accountItems = React.useMemo(
    () => [
      ...accountRoutes,
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
  const tokenWorkspaceItems = React.useMemo(
    () =>
      tokenWorkspaceRoutes.map((item) => {
        if (item.title === "Holdings") {
          const walletsWithHoldings =
            sidebarCountsQuery.data?.walletsWithHoldings ?? 0;
          return {
            ...item,
            badge:
              walletsWithHoldings > 0 ? String(walletsWithHoldings) : undefined,
            badgeTooltip: `${walletsWithHoldings} wallets with holdings.`,
          };
        }

        if (item.title === "Wallets") {
          const walletsWithBalance =
            sidebarCountsQuery.data?.walletsWithBalance ?? 0;
          return {
            ...item,
            badge:
              walletsWithBalance > 0 ? String(walletsWithBalance) : undefined,
            badgeTooltip: `${walletsWithBalance} non-main wallets with active balance.`,
          };
        }

        if (item.title === "Volume Bot") {
          const activeVolumeBotSessions =
            sidebarCountsQuery.data?.activeVolumeBotSessions ?? 0;
          return {
            ...item,
            badge:
              activeVolumeBotSessions > 0
                ? String(activeVolumeBotSessions)
                : undefined,
            badgeTooltip: `${activeVolumeBotSessions} volume bot sessions running.`,
          };
        }

        return item;
      }),
    [
      sidebarCountsQuery.data?.activeVolumeBotSessions,
      sidebarCountsQuery.data?.walletsWithBalance,
      sidebarCountsQuery.data?.walletsWithHoldings,
    ]
  );

  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader>
        <TokenSwitcher tokens={props.tokens} />
      </SidebarHeader>
      <SidebarContent>
        <NavMain
          title="Token Workspace"
          items={tokenWorkspaceItems}
          currentToken={effectiveTokenPublicKey}
        />
        <NavMain
          title="Account"
          items={accountItems}
          currentToken={effectiveTokenPublicKey}
          className="mt-auto pt-6"
        />
        <NavMain title="Contact & Help" items={helpRoutes} className="pt-2" />
      </SidebarContent>
    </Sidebar>
  );
});
