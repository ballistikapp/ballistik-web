"use client";

import {
  PageSection,
  PageSectionHeader,
} from "@/components/layout/sections";

export function PayoutsSection() {
  return (
    <PageSection>
      <PageSectionHeader title="Referral Payouts" />
      <p className="text-muted-foreground text-sm">
        Payouts from referred Users&apos; platform fees will appear here.
      </p>
    </PageSection>
  );
}
