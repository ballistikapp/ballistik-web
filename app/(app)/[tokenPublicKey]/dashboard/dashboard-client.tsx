"use client";

import { useParams } from "next/navigation";
import { trpc } from "@/lib/trpc/client";
import { TokenNotFound } from "@/components/placeholders/token-not-found";
import { DashboardLoading } from "./dashboard-loading";
import { DashboardHeader } from "./dashboard-header";
import { DashboardStats } from "./dashboard-stats";
import { DashboardHoldings } from "./dashboard-holdings";
import { DashboardOperations } from "./dashboard-operations";
import { DashboardTransactions } from "./dashboard-transactions";
import { DashboardDefiPools } from "./dashboard-defi-pools";
import { PriceChart } from "./price-chart";

export function DashboardClient() {
  const { tokenPublicKey } = useParams<{ tokenPublicKey: string }>();

  const {
    data: tokenData,
    isLoading: tokenLoading,
    error: tokenError,
    refetch: refetchToken,
  } = trpc.token.getByPublicKey.useQuery(
    { publicKey: tokenPublicKey || "" },
    { enabled: !!tokenPublicKey }
  );

  const {
    data: statsData,
    isLoading: statsLoading,
    refetch: refetchStats,
    isFetching: statsRefreshing,
  } = trpc.dashboard.getStats.useQuery(
    { tokenPublicKey: tokenPublicKey || "" },
    { enabled: !!tokenPublicKey && !!tokenData }
  );

  const { data: defiData } = trpc.dashboard.getDefiPools.useQuery(
    { tokenPublicKey: tokenPublicKey || "" },
    {
      enabled:
        !!tokenPublicKey &&
        !!statsData?.header.isComplete,
    }
  );

  if (tokenLoading) {
    return <DashboardLoading />;
  }

  if (!tokenData) {
    return <TokenNotFound error={tokenError} onRetry={() => refetchToken()} />;
  }

  const handleRefresh = () => {
    refetchToken();
    refetchStats();
  };

  return (
    <div className="flex flex-col gap-6">
      {statsLoading || !statsData ? (
        <DashboardLoading compact />
      ) : (
        <>
          <DashboardHeader
            token={tokenData}
            header={statsData.header}
            onRefresh={handleRefresh}
            isRefreshing={statsRefreshing}
          />
          <DashboardStats metrics={statsData.metrics} />
          <DashboardOperations
            operations={statsData.operations}
            tokenPublicKey={tokenPublicKey}
          />
          <PriceChart
            priceHistory={statsData.priceHistory}
            currentPrice={{
              priceSol: statsData.header.priceSol,
              isComplete: statsData.header.isComplete,
            }}
          />
          {defiData && defiData.pools.length > 0 && (
            <DashboardDefiPools pools={defiData.pools} />
          )}
          <DashboardHoldings holdings={statsData.holdingsBreakdown} tokenPublicKey={tokenPublicKey} />
          <DashboardTransactions
            transactions={statsData.recentTransactions}
            tokenPublicKey={tokenPublicKey}
          />
        </>
      )}
    </div>
  );
}
