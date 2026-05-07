import type { ReactNode } from "react";
import type { Metadata } from "next";
import { AccountLayoutHeader } from "@/components/account/account-layout-header";
import { AccountSubNavigation } from "@/components/account/account-sub-navigation";

export const metadata: Metadata = {
  title: "Account",
};

type AccountLayoutProps = {
  children: ReactNode;
};

export default function AccountLayout({ children }: AccountLayoutProps) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <AccountLayoutHeader />
      <div className="flex min-h-0 flex-1 flex-col gap-6 lg:flex-row lg:items-stretch lg:min-h-[calc(100svh-var(--header-height)-12rem)]">
        <aside className="relative -ml-4 flex w-[calc(100%+1rem)] shrink-0 flex-col self-stretch lg:sticky lg:top-[var(--header-height)] lg:-ml-6 lg:w-44 xl:-ml-8">
          {/* Extends into app shell `md:py-6` bottom padding so the rule is flush with the inset edge */}
          <div
            aria-hidden
            className="pointer-events-none absolute top-0 right-0 hidden w-px bg-border lg:-bottom-6 lg:block"
          />
          <div className="flex min-h-0 flex-1 flex-col border-b pb-4 lg:min-h-full lg:border-b-0 lg:pb-0">
            <AccountSubNavigation className="px-4 py-4" />
          </div>
        </aside>
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </div>
  );
}
