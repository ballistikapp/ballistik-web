"use client";

import {
  PageHeader,
  PageSection,
  PageSectionDivider,
  PageSectionHeader,
} from "@/components/layout/sections";
import { MarketerApplicationForm } from "@/components/marketer/marketer-application-form";
import { MarketerSetupForm } from "@/components/marketer/marketer-setup-form";
import { PayoutsSection } from "@/components/marketer/payouts-section";
import { ReferredUsersSection } from "@/components/marketer/referred-users-section";
import { Skeleton } from "@/components/ui/skeleton";
import { trpc } from "@/lib/trpc/client";

function formatWhen(value: Date) {
  return new Date(value).toLocaleString();
}

export default function ReferralsPage() {
  const { data, isLoading, isError, error } = trpc.marketer.getMe.useQuery(
    undefined,
    { retry: false }
  );

  if (isError) {
    return (
      <p className="text-destructive py-8 text-sm">
        {error.message || "Failed to load Referrals"}
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

  if (data.status === "can_apply") {
    return (
      <div className="flex flex-col">
        <PageHeader title="Referrals" />
        <PageSection>
          <MarketerApplicationForm />
        </PageSection>
      </div>
    );
  }

  if (data.status === "pending") {
    return (
      <div className="flex flex-col">
        <PageHeader title="Referrals" />
        <PageSection>
          <PageSectionHeader title="Application pending" />
          <p className="text-muted-foreground mb-4 text-sm">
            Operators are reviewing your Marketer Application. You&apos;ll get
            the Marketer dashboard once designated.
          </p>
          <div className="bg-muted/40 max-w-xl rounded-md border p-4 text-sm">
            <p className="text-muted-foreground mb-1 text-xs">
              Submitted {formatWhen(data.application.createdAt)}
            </p>
            <p className="whitespace-pre-wrap">{data.application.message}</p>
          </div>
        </PageSection>
      </div>
    );
  }

  if (data.status === "rejected") {
    return (
      <div className="flex flex-col">
        <PageHeader title="Referrals" />
        <PageSection>
          <PageSectionHeader title="Application rejected" />
          <p className="text-muted-foreground mb-4 text-sm">
            Your previous Marketer Application was rejected. You can submit a
            new one below.
          </p>
          <div className="bg-muted/40 mb-6 max-w-xl rounded-md border p-4 text-sm">
            <p className="text-muted-foreground mb-1 text-xs">
              Submitted {formatWhen(data.application.createdAt)}
            </p>
            <p className="mb-3 whitespace-pre-wrap">
              {data.application.message}
            </p>
            {data.application.operatorNote ? (
              <div>
                <p className="text-muted-foreground mb-1 text-xs">
                  Operator note
                </p>
                <p className="whitespace-pre-wrap">
                  {data.application.operatorNote}
                </p>
              </div>
            ) : null}
          </div>
          <MarketerApplicationForm heading="Submit a new Application" />
        </PageSection>
      </div>
    );
  }

  const readOnly = data.status === "disabled";

  return (
    <div className="flex flex-col">
      <PageHeader title="Referrals" />
      {readOnly ? (
        <PageSection>
          <p className="text-muted-foreground text-sm">
            Your Marketer designation is disabled. Setup and history are
            read-only; new Applications are not available.
          </p>
        </PageSection>
      ) : null}
      <PageSection>
        <PageSectionHeader title="Setup" />
        <p className="text-muted-foreground mb-6 text-sm">
          {readOnly
            ? "Referral code and fee-collector wallet (read-only)."
            : "Choose a referral code and fee-collector wallet, then share your auth link."}
        </p>
        <MarketerSetupForm setup={data.setup} readOnly={readOnly} />
      </PageSection>
      <PageSectionDivider />
      <ReferredUsersSection />
      <PageSectionDivider />
      <PayoutsSection />
    </div>
  );
}
