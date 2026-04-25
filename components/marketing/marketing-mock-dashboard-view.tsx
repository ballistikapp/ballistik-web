"use client";

import { DashboardHeader } from "@/app/(app)/[tokenPublicKey]/dashboard/dashboard-header";
import { DashboardStats } from "@/app/(app)/[tokenPublicKey]/dashboard/dashboard-stats";
import { DashboardOperations } from "@/app/(app)/[tokenPublicKey]/dashboard/dashboard-operations";
import { PriceChart } from "@/app/(app)/[tokenPublicKey]/dashboard/price-chart";
import { marketingMockDashboard } from "@/lib/config/marketing-mock-dashboard.config";
import { MarketingMockCreatorRewardsCard } from "./marketing-mock-creator-rewards-card";
import { DashboardBuySellActions } from "@/app/(app)/[tokenPublicKey]/dashboard/dashboard-buy-sell-actions";

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
      <DashboardStats header={m.statsHeader} metrics={m.metrics} />
      <div className="grid grid-cols-1 gap-4 @5xl/main:grid-cols-8 @5xl/main:items-stretch">
        <div className="min-w-0 @5xl/main:col-span-3">
          <DashboardOperations
            operations={m.operations}
            tokenPublicKey={m.tokenPublicKey}
          />
        </div>
        <div className="min-w-0 @5xl/main:col-span-3">
          <MarketingMockCreatorRewardsCard
            claimableSol={m.creatorRewards.claimableSol}
            paidOutSol={m.creatorRewards.paidOutSol}
            lastReconciledAt={m.creatorRewards.lastReconciledAt}
          />
        </div>
        <div className="min-w-0 @5xl/main:col-span-2">
          <DashboardBuySellActions
            onOpenBuyDialog={() => {}}
            onOpenExitDialog={() => {}}
            buyDisabled={false}
            exitDisabled={false}
            hasHoldings
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
