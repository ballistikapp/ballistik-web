"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { toast } from "sonner";
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
import { MonitoringPanel } from "@/components/dashboard/monitoring-panel";

const POLL_INTERVAL = 30_000;
const DEBOUNCE_MS = 2_000;
const MONITORING_HOUR_THRESHOLD = 60 * 60 * 1000;

function getStoredMonitoringOverride(tokenPublicKey: string): boolean | null {
  if (typeof window === "undefined") return null;
  const stored = localStorage.getItem(`monitoring:${tokenPublicKey}`);
  if (stored === "true") return true;
  if (stored === "false") return false;
  return null;
}

function setStoredMonitoringOverride(
  tokenPublicKey: string,
  value: boolean
): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(`monitoring:${tokenPublicKey}`, String(value));
}

function shouldDefaultMonitoring(
  launchCompletedAt: Date | string | null | undefined
): boolean {
  if (!launchCompletedAt) return false;
  const launchTime =
    typeof launchCompletedAt === "string"
      ? new Date(launchCompletedAt)
      : launchCompletedAt;
  return Date.now() - launchTime.getTime() < MONITORING_HOUR_THRESHOLD;
}

export function DashboardClient() {
  const { tokenPublicKey } = useParams<{ tokenPublicKey: string }>();

  const [userMonitoringOverride, setUserMonitoringOverride] = useState<{
    tokenPublicKey: string;
    enabled: boolean;
  } | null>(null);
  const [sseError, setSseError] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
    dataUpdatedAt,
  } = trpc.dashboard.getStats.useQuery(
    { tokenPublicKey: tokenPublicKey || "" },
    {
      enabled: !!tokenPublicKey && !!tokenData,
      refetchInterval: POLL_INTERVAL,
    }
  );

  const { data: defiData, refetch: refetchDefi } =
    trpc.dashboard.getDefiPools.useQuery(
      { tokenPublicKey: tokenPublicKey || "" },
      {
        enabled: !!tokenPublicKey && !!statsData?.header.isComplete,
        refetchInterval: POLL_INTERVAL,
      }
    );

  const storedMonitoringOverride = tokenPublicKey
    ? getStoredMonitoringOverride(tokenPublicKey)
    : null;
  const activeMonitoringOverride =
    userMonitoringOverride?.tokenPublicKey === tokenPublicKey
      ? userMonitoringOverride.enabled
      : storedMonitoringOverride;
  const isMonitoring =
    activeMonitoringOverride ??
    (statsData
      ? shouldDefaultMonitoring(statsData.header.launchCompletedAt)
      : false);
  const monitoringInitialized = Boolean(statsData && tokenPublicKey);

  const grpcStatusQuery = trpc.dashboard.getGrpcStatus.useQuery(undefined, {
    enabled: false,
  });

  const handleToggleMonitoring = useCallback(
    async (enabled: boolean) => {
      if (!tokenPublicKey) return;

      if (enabled) {
        try {
          const { data } = await grpcStatusQuery.refetch();
          if (!data?.available) {
            toast.error("Real-time monitoring is unavailable");
            return;
          }
        } catch {
          toast.error("Real-time monitoring is unavailable");
          return;
        }
      }

      setUserMonitoringOverride({ tokenPublicKey, enabled });
      setStoredMonitoringOverride(tokenPublicKey, enabled);
    },
    [tokenPublicKey, grpcStatusQuery]
  );

  const debouncedRefetch = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      refetchStats();
    }, DEBOUNCE_MS);
  }, [refetchStats]);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const handleSubscriptionData = useCallback(() => {
    setSseError(false);
    debouncedRefetch();
  }, [debouncedRefetch]);

  const handleSubscriptionError = useCallback(() => {
    setSseError(true);
  }, []);

  trpc.subscription.onNewTransaction.useSubscription(
    { tokenPublicKey: tokenPublicKey || "" },
    {
      enabled: !!tokenPublicKey && !!tokenData && isMonitoring,
      onData: handleSubscriptionData,
      onError: handleSubscriptionError,
    }
  );

  trpc.subscription.onBalanceUpdate.useSubscription(
    { tokenPublicKey: tokenPublicKey || "" },
    {
      enabled: !!tokenPublicKey && !!tokenData && isMonitoring,
      onData: handleSubscriptionData,
      onError: handleSubscriptionError,
    }
  );

  trpc.subscription.onTokenBalanceUpdate.useSubscription(
    { tokenPublicKey: tokenPublicKey || "" },
    {
      enabled: !!tokenPublicKey && !!tokenData && isMonitoring,
      onData: handleSubscriptionData,
      onError: handleSubscriptionError,
    }
  );

  trpc.subscription.onVolumeBotUpdate.useSubscription(
    { tokenPublicKey: tokenPublicKey || "" },
    {
      enabled: !!tokenPublicKey && !!tokenData && isMonitoring,
      onData: handleSubscriptionData,
      onError: handleSubscriptionError,
    }
  );

  const { mutateAsync: refreshBalances } =
    trpc.wallet.refreshBalances.useMutation();
  const { mutateAsync: refreshHoldings } =
    trpc.holding.refreshByToken.useMutation();
  const [fullRefreshing, setFullRefreshing] = useState(false);

  const handleFullRefresh = useCallback(async () => {
    if (!tokenPublicKey) return;
    setFullRefreshing(true);
    try {
      await Promise.allSettled([
        refreshBalances({ tokenPublicKey, force: true }),
        refreshHoldings({ tokenPublicKey }),
      ]);
    } finally {
      refetchToken();
      refetchStats();
      refetchDefi();
      setFullRefreshing(false);
    }
  }, [
    tokenPublicKey,
    refreshBalances,
    refreshHoldings,
    refetchToken,
    refetchStats,
    refetchDefi,
  ]);

  const handleLightRefresh = useCallback(() => {
    refetchToken();
    refetchStats();
    refetchDefi();
  }, [refetchToken, refetchStats, refetchDefi]);

  const needsFullRefresh = !isMonitoring || sseError;

  const handleRefresh = useCallback(async () => {
    if (needsFullRefresh) {
      await handleFullRefresh();
    } else {
      handleLightRefresh();
    }
  }, [needsFullRefresh, handleFullRefresh, handleLightRefresh]);

  if (tokenLoading) {
    return <DashboardLoading />;
  }

  if (!tokenData) {
    return <TokenNotFound error={tokenError} onRetry={() => refetchToken()} />;
  }

  return (
    <div className="flex flex-col gap-6">
      {statsLoading || !statsData ? (
        <DashboardLoading compact />
      ) : (
        <>
          <DashboardHeader
            token={tokenData}
            header={statsData.header}
            onRefresh={handleFullRefresh}
            isRefreshing={fullRefreshing || statsRefreshing}
          />
          <DashboardStats metrics={statsData.metrics} />
          <DashboardOperations
            operations={statsData.operations}
            tokenPublicKey={tokenPublicKey}
          />
          <PriceChart
            tokenPublicKey={tokenPublicKey}
            isComplete={statsData.header.isComplete}
            priceHistory={statsData.priceHistory}
            currentPriceSol={statsData.header.priceSol}
          />
          {defiData && defiData.pools.length > 0 && (
            <DashboardDefiPools pools={defiData.pools} />
          )}
          <DashboardHoldings
            holdings={statsData.holdingsBreakdown}
            tokenPublicKey={tokenPublicKey}
          />
          <DashboardTransactions
            transactions={statsData.recentTransactions}
            tokenPublicKey={tokenPublicKey}
          />
        </>
      )}

      {monitoringInitialized && (
        <MonitoringPanel
          isMonitoring={isMonitoring}
          onToggleMonitoring={handleToggleMonitoring}
          onRefresh={handleRefresh}
          isRefreshing={fullRefreshing || statsRefreshing}
          isFullRefresh={needsFullRefresh}
          dataUpdatedAt={dataUpdatedAt}
          sseError={sseError}
        />
      )}
    </div>
  );
}
