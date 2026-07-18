"use client";

import {
  PageSection,
  PageSectionHeader,
} from "@/components/layout/sections";

export function ReferredUsersSection() {
  return (
    <PageSection>
      <PageSectionHeader title="Referred Users" />
      <p className="text-muted-foreground text-sm">
        Users attributed to your referral code will appear here.
      </p>
    </PageSection>
  );
}
