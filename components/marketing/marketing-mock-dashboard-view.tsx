"use client";

import { DashboardHeader } from "@/app/(app)/[tokenPublicKey]/dashboard/dashboard-header";
import { DashboardStats } from "@/app/(app)/[tokenPublicKey]/dashboard/dashboard-stats";
import { DashboardOperations } from "@/app/(app)/[tokenPublicKey]/dashboard/dashboard-operations";
import { PriceChart } from "@/app/(app)/[tokenPublicKey]/dashboard/price-chart";
import { marketingMockDashboard } from "@/lib/config/marketing-mock-dashboard.config";
import { MarketingMockCreatorRewardsCard } from "./marketing-mock-creator-rewards-card";

export function MarketingMockDashboardView() {
  const m = marketingMockDashboard;

  return (
    <div className="flex flex-col gap-6">
      <DashboardHeader
        token={m.tokenDisplay}
        onRefresh={() => {}}
        isRefreshing={false}
        refreshStatusLabel={m.refreshStatusLabel}
      />
      <DashboardStats
        header={m.statsHeader}
        metrics={m.metrics}
        onOpenExitDialog={() => {}}
        exitDisabled={false}
        exitPending={false}
      />
      <div className="grid grid-cols-1 gap-4 @5xl/main:grid-cols-2 @5xl/main:items-stretch">
        <div className="min-w-0">
          <DashboardOperations
            operations={m.operations}
            tokenPublicKey={m.tokenPublicKey}
          />
        </div>
        <div className="min-w-0">
          <MarketingMockCreatorRewardsCard
            claimableSol={m.creatorRewards.claimableSol}
            paidOutSol={m.creatorRewards.paidOutSol}
            lastReconciledAt={m.creatorRewards.lastReconciledAt}
          />
        </div>
      </div>
      <PriceChart
        tokenPublicKey={m.tokenPublicKey}
        isComplete={false}
        priceHistory={[...m.priceHistory]}
        currentPriceSol={m.statsHeader.priceSol}
        chartDescription={m.priceChartDescription}
      />
    </div>
  );
}
