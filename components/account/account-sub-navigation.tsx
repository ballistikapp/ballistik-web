"use client";

import { SubNavigation } from "@/components/layout/sections";
import type { SubNavigationItem } from "@/components/layout/sections";
import { cn } from "@/lib/utils";

const accountNavigationItems: SubNavigationItem[] = [
  {
    href: "/account/main-wallet",
    content: "Main Wallet",
  },
  {
    href: "/account/auth-wallet",
    content: "Auth Wallet",
  },
  {
    href: "/account/subscription",
    content: "Subscription",
  },
];

type AccountSubNavigationProps = {
  className?: string;
};

export function AccountSubNavigation({ className }: AccountSubNavigationProps) {
  return (
    <div className={cn("flex w-full flex-col gap-2", className)}>
      <SubNavigation items={accountNavigationItems} />
    </div>
  );
}
