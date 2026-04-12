import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { MarketingMockDashboardShell } from "@/components/marketing/marketing-mock-dashboard-shell";
import { MarketingMockDashboardView } from "@/components/marketing/marketing-mock-dashboard-view";

export const metadata: Metadata = {
  title: "Marketing preview",
  robots: { index: false, follow: false },
};

export default function MarketingMockDashboardPage() {
  if (
    process.env.NODE_ENV === "production" &&
    process.env.MARKETING_MOCK_DASHBOARD !== "true"
  ) {
    notFound();
  }

  return (
    <MarketingMockDashboardShell>
      <MarketingMockDashboardView />
    </MarketingMockDashboardShell>
  );
}
