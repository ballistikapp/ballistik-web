"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  PageHeader,
  PageSection,
  PageSectionDivider,
  PageSectionHeader,
} from "@/components/layout/sections";
import { MarketerSetupForm } from "@/components/marketer/marketer-setup-form";
import { PayoutsSection } from "@/components/marketer/payouts-section";
import { ReferredUsersSection } from "@/components/marketer/referred-users-section";
import { Skeleton } from "@/components/ui/skeleton";
import { trpc } from "@/lib/trpc/client";

export default function ReferralsPage() {
  const router = useRouter();
  const { data, isLoading, isFetched, isError, error } =
    trpc.marketer.getMe.useQuery(undefined, { retry: false });

  useEffect(() => {
    if (isFetched && data === null) {
      router.replace("/account");
    }
  }, [data, isFetched, router]);

  if (isError) {
    return (
      <p className="text-destructive py-8 text-sm">
        {error.message || "Failed to load referral setup"}
      </p>
    );
  }

  if (isLoading || !data) {
    return (
      <div className="flex flex-col gap-6">
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      <PageHeader title="Referrals" />
      <PageSection>
        <PageSectionHeader title="Setup" />
        <p className="text-muted-foreground mb-6 text-sm">
          Choose a referral code and fee-collector wallet, then share your auth
          link.
        </p>
        <MarketerSetupForm setup={data} />
      </PageSection>
      <PageSectionDivider />
      <ReferredUsersSection />
      <PageSectionDivider />
      <PayoutsSection />
    </div>
  );
}
