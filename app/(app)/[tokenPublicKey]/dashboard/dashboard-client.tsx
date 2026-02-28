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
import { HoldingExitDialog } from "@/components/holdings/holding-exit-dialog";

const POLL_INTERVAL = 30_000;
const DEBOUNCE_MS = 2_000;
const MONITORING_HOUR_THRESHOLD = 60 * 60 * 1000;
const HEALTH_CHECK_INTERVAL = 30_000;
const STALE_THRESHOLD_MS = 90_000;

type MonitoringHealthState = "off" | "healthy" | "degraded" | "failed";

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
  const [lastSseEventAt, setLastSseEventAt] = useState<number | null>(null);
  const [grpcConnected, setGrpcConnected] = useState<boolean | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [manualExitDialogOpen, setManualExitDialogOpen] = useState(false);
  const [localExitId, setLocalExitId] = useState<string | null>(null);
  const [dismissedExitId, setDismissedExitId] = useState<string | null>(null);
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
      if (!enabled) {
        setSseError(false);
        setLastSseEventAt(null);
        setGrpcConnected(null);
      }
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

  useEffect(() => {
    if (!isMonitoring) return;
    const timer = setInterval(() => setNowMs(Date.now()), 5_000);
    return () => clearInterval(timer);
  }, [isMonitoring]);

  useEffect(() => {
    if (!isMonitoring) return;

    let cancelled = false;
    const checkHealth = async () => {
      try {
        const { data } = await grpcStatusQuery.refetch();
        if (cancelled) return;
        setGrpcConnected(Boolean(data?.connected && data?.available));
      } catch {
        if (!cancelled) setGrpcConnected(false);
      }
    };

    checkHealth();
    const timer = setInterval(checkHealth, HEALTH_CHECK_INTERVAL);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [grpcStatusQuery, isMonitoring]);

  const handleSubscriptionData = useCallback(() => {
    setSseError(false);
    setLastSseEventAt(Date.now());
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

  trpc.subscription.onIngestionComplete.useSubscription(
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
  const { mutateAsync: refreshTransactions } =
    trpc.transaction.refreshByToken.useMutation();
  const startExitMutation = trpc.holding.startExit.useMutation();
  const cancelExitMutation = trpc.holding.cancelExit.useMutation();
  const activeExitQuery = trpc.holding.getActiveExit.useQuery(
    { tokenPublicKey: tokenPublicKey || "" },
    { enabled: !!tokenPublicKey }
  );
  const activeExitId = localExitId ?? activeExitQuery.data?.id ?? null;
  const exitStatusQuery = trpc.holding.exitStatus.useQuery(
    { exitId: activeExitId ?? "" },
    {
      enabled: Boolean(activeExitId),
      refetchInterval: (query) => {
        const exit = query.state.data;
        if (!exit) return 2000;
        return exit.status === "PENDING" || exit.status === "RUNNING"
          ? 2000
          : false;
      },
    }
  );
  const [fullRefreshing, setFullRefreshing] = useState(false);

  const handleFullRefresh = useCallback(async () => {
    if (!tokenPublicKey) return;
    setFullRefreshing(true);
    try {
      await Promise.allSettled([
        refreshBalances({ tokenPublicKey, force: true }),
        refreshHoldings({ tokenPublicKey }),
        refreshTransactions({ tokenPublicKey }),
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
    refreshTransactions,
    refetchToken,
    refetchStats,
    refetchDefi,
  ]);

  const handleLightRefresh = useCallback(() => {
    refetchToken();
    refetchStats();
    refetchDefi();
  }, [refetchToken, refetchStats, refetchDefi]);

  useEffect(() => {
    if (!isMonitoring || !monitoringInitialized) return;
    handleLightRefresh();
  }, [isMonitoring, monitoringInitialized, handleLightRefresh]);

  const staleByStats = dataUpdatedAt > 0 && nowMs - dataUpdatedAt > STALE_THRESHOLD_MS;
  const staleByEvents =
    lastSseEventAt !== null && nowMs - lastSseEventAt > STALE_THRESHOLD_MS;
  const monitoringHealthState: MonitoringHealthState = !isMonitoring
    ? "off"
    : sseError || grpcConnected === false
      ? "failed"
      : staleByStats && staleByEvents
        ? "degraded"
        : "healthy";
  const needsFullRefresh =
    !isMonitoring || monitoringHealthState === "failed" || monitoringHealthState === "degraded";

  const handleRefresh = useCallback(async () => {
    if (needsFullRefresh) {
      await handleFullRefresh();
    } else {
      handleLightRefresh();
    }
  }, [needsFullRefresh, handleFullRefresh, handleLightRefresh]);

  const handleExit = useCallback(
    async (jitoTipSol: number, returnSolToMainWallet: boolean) => {
      if (!tokenPublicKey) return;
      const result = await startExitMutation.mutateAsync({
        tokenPublicKey,
        jitoTipSol,
        returnSolToMainWallet,
      });
      setLocalExitId(result.exitId);
      setManualExitDialogOpen(true);
      setDismissedExitId(null);
    },
    [tokenPublicKey, startExitMutation]
  );

  const handleCancelExit = useCallback(async () => {
    if (!activeExitId) return;
    await cancelExitMutation.mutateAsync({ exitId: activeExitId });
    await exitStatusQuery.refetch();
  }, [activeExitId, cancelExitMutation, exitStatusQuery]);

  const exitData = exitStatusQuery.data ?? activeExitQuery.data ?? null;
  const exitStatus = exitData?.status;
  const shouldAutoOpen =
    Boolean(activeExitId) && dismissedExitId !== activeExitId;
  const isExitDialogOpen = manualExitDialogOpen || shouldAutoOpen;

  const handleOpenExitDialog = useCallback(() => {
    setManualExitDialogOpen(true);
    setDismissedExitId(null);
  }, []);

  const handleExitDialogOpenChange = useCallback(
    (open: boolean) => {
      setManualExitDialogOpen(open);
      if (open) {
        setDismissedExitId(null);
        return;
      }
      if (activeExitId) {
        setDismissedExitId(activeExitId);
      }
      if (activeExitId && exitStatus && exitStatus !== "RUNNING") {
        setLocalExitId(null);
      }
    },
    [activeExitId, exitStatus]
  );

  const walletsWithBalance =
    statsData?.holdingsBreakdown.userWallets.filter(
      (wallet) =>
        Number.isFinite(Number(wallet.tokenBalance)) &&
        Number(wallet.tokenBalance) > 0
    ).length ?? 0;
  const totalWallets = statsData?.holdingsBreakdown.userWallets.length ?? 0;
  const totalBalance = statsData?.holdingsBreakdown.userTotalTokens ?? 0;

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
          <DashboardStats
            metrics={statsData.metrics}
            onOpenExitDialog={handleOpenExitDialog}
            exitDisabled={
              startExitMutation.isPending || exitStatus === "RUNNING"
            }
            exitPending={startExitMutation.isPending}
          />
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
          <HoldingExitDialog
            open={isExitDialogOpen}
            onOpenChange={handleExitDialogOpenChange}
            exit={exitData}
            tokenSymbol={tokenData.symbol}
            totalWallets={totalWallets}
            walletsWithBalance={walletsWithBalance}
            totalBalance={totalBalance}
            isSubmitting={startExitMutation.isPending}
            isCancelling={cancelExitMutation.isPending}
            onConfirm={handleExit}
            onCancel={handleCancelExit}
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
          healthState={monitoringHealthState}
          dataUpdatedAt={dataUpdatedAt}
        />
      )}
    </div>
  );
}
