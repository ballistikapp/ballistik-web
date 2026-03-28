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
import {
  buildDashboardFullSnapshotPayload,
  buildDashboardSummaryPayload,
} from "./dashboard-log-payload";

const POLL_INTERVAL = 30_000;
const DEBOUNCE_MS = 2_000;
const MONITORING_HOUR_THRESHOLD = 60 * 60 * 1000;
const HEALTH_CHECK_INTERVAL = 30_000;
const STALE_THRESHOLD_MS = 90_000;
const HOLDINGS_REFRESH_DEBOUNCE_MS = 1_500;
const MONITORING_HOLDINGS_SAFETY_INTERVAL_MS = 12_000;
const MONITORING_ACTIVITY_WINDOW_MS = 60_000;
const HOLDINGS_STALE_THRESHOLD_MS = 20_000;
const ACCOUNT_SUBSCRIPTION_HREF = "/account/subscription";

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
  const holdingsRefreshDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  );
  const lastMonitoringActivityAtRef = useRef<number | null>(null);
  const lastDashboardTriggerRef = useRef("initial-load");
  const lastLoggedStatsUpdateAtRef = useRef<number | null>(null);

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

  const grpcStatusQuery = trpc.dashboard.getGrpcStatus.useQuery(undefined, {
    enabled: !!tokenPublicKey,
  });

  const storedMonitoringOverride = tokenPublicKey
    ? getStoredMonitoringOverride(tokenPublicKey)
    : null;
  const activeMonitoringOverride =
    userMonitoringOverride?.tokenPublicKey === tokenPublicKey
      ? userMonitoringOverride.enabled
      : storedMonitoringOverride;
  const liveMonitoringAllowed = grpcStatusQuery.data?.available ?? false;
  const desiredMonitoring =
    activeMonitoringOverride ??
    (statsData
      ? shouldDefaultMonitoring(statsData.header.launchCompletedAt)
      : false);
  const isMonitoring = desiredMonitoring && liveMonitoringAllowed;
  const monitoringInitialized = Boolean(statsData && tokenPublicKey);
  const { data: testRunLogConfig } = trpc.testRunLog.getConfig.useQuery(undefined, {
    enabled: !!tokenPublicKey,
  });
  const appendTestRunEvent = trpc.testRunLog.appendEvent.useMutation();
  const { mutateAsync: refreshBalances } =
    trpc.wallet.refreshBalances.useMutation();
  const { mutateAsync: refreshHoldings } =
    trpc.holding.refreshByToken.useMutation();
  const { mutateAsync: monitoringRefreshHoldings } =
    trpc.holding.monitoringRefreshByToken.useMutation();
  const { mutateAsync: refreshTransactions } =
    trpc.transaction.refreshByToken.useMutation();

  const handleToggleMonitoring = useCallback(
    async (enabled: boolean) => {
      if (!tokenPublicKey) return;

      if (enabled) {
        try {
          const { data } = await grpcStatusQuery.refetch();
          if (!data?.available) {
            toast.error(
              data?.accessReason === "not_pro"
                ? "Upgrade to Pro on your subscription page to activate live monitoring"
                : "Real-time monitoring is unavailable"
            );
            return;
          }
        } catch {
          toast.error("Real-time monitoring is unavailable");
          return;
        }
      }

      setUserMonitoringOverride({ tokenPublicKey, enabled });
      setStoredMonitoringOverride(tokenPublicKey, enabled);
      if (testRunLogConfig?.enabled) {
        appendTestRunEvent.mutate({
          eventType: "dashboard_subscription_event",
          source: "dashboard-client",
          tokenPublicKey,
          page: "dashboard",
          action: "toggle-monitoring",
          status: enabled ? "enabled" : "disabled",
        });
      }
      if (!enabled) {
        setSseError(false);
        setLastSseEventAt(null);
        setGrpcConnected(null);
      }
    },
    [appendTestRunEvent, grpcStatusQuery, testRunLogConfig?.enabled, tokenPublicKey]
  );

  const logDashboardEvent = useCallback(
    (
      event: Parameters<typeof appendTestRunEvent.mutate>[0],
      options?: { trigger?: string }
    ) => {
      if (!tokenPublicKey || !testRunLogConfig?.enabled) return;
      if (options?.trigger) {
        lastDashboardTriggerRef.current = options.trigger;
      }
      appendTestRunEvent.mutate({
        tokenPublicKey,
        page: "dashboard",
        source: "dashboard-client",
        ...event,
      });
    },
    [appendTestRunEvent, testRunLogConfig?.enabled, tokenPublicKey]
  );

  const debouncedRefetch = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      lastDashboardTriggerRef.current = "dashboard.debounced-refetch";
      refetchStats();
    }, DEBOUNCE_MS);
  }, [refetchStats]);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (holdingsRefreshDebounceRef.current) {
        clearTimeout(holdingsRefreshDebounceRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!isMonitoring) {
      lastMonitoringActivityAtRef.current = null;
      if (holdingsRefreshDebounceRef.current) {
        clearTimeout(holdingsRefreshDebounceRef.current);
        holdingsRefreshDebounceRef.current = null;
      }
    }
  }, [isMonitoring]);

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

  const runMonitoringHoldingsRefresh = useCallback(
    async (source: string, force = false) => {
      if (!tokenPublicKey || !isMonitoring) return;
      try {
        const result = await monitoringRefreshHoldings({
          tokenPublicKey,
          force,
        });
        logDashboardEvent(
          {
            eventType: "dashboard_refresh",
            action: "monitoring-holdings-refresh",
            refreshMode: "monitoring",
            trigger: source,
            status: result.status,
            actualValue: result,
          },
          { trigger: `monitoring-holdings:${source}` }
        );
      } catch (error) {
        logDashboardEvent({
          eventType: "run_issue",
          action: "monitoring-holdings-refresh",
          trigger: source,
          error:
            error instanceof Error
              ? { name: error.name, message: error.message }
              : String(error),
        });
        console.error("monitoring holdings refresh failed", { source, force, error });
      } finally {
        refetchStats();
      }
    },
    [
      isMonitoring,
      logDashboardEvent,
      monitoringRefreshHoldings,
      refetchStats,
      tokenPublicKey,
    ]
  );

  const scheduleMonitoringHoldingsRefresh = useCallback(
    (source: string, force = false) => {
      if (!tokenPublicKey || !isMonitoring) return;
      if (holdingsRefreshDebounceRef.current) {
        clearTimeout(holdingsRefreshDebounceRef.current);
      }
      holdingsRefreshDebounceRef.current = setTimeout(() => {
        holdingsRefreshDebounceRef.current = null;
        void runMonitoringHoldingsRefresh(source, force);
      }, HOLDINGS_REFRESH_DEBOUNCE_MS);
    },
    [isMonitoring, runMonitoringHoldingsRefresh, tokenPublicKey]
  );

  const handleSubscriptionData = useCallback(
    (
      source: string,
      _payload: unknown,
      options?: { triggerHoldingsRefresh?: boolean; markActivity?: boolean }
    ) => {
      setSseError(false);
      setLastSseEventAt(Date.now());
      if (options?.markActivity) {
        lastMonitoringActivityAtRef.current = Date.now();
      }
      logDashboardEvent(
        {
          eventType: "dashboard_subscription_event",
          action: source,
          trigger: options?.triggerHoldingsRefresh ? "refresh-and-refetch" : "refetch",
          actualValue: _payload,
        },
        { trigger: `sse:${source}` }
      );
      if (options?.triggerHoldingsRefresh) {
        scheduleMonitoringHoldingsRefresh(`event:${source}`);
      }
      debouncedRefetch();
    },
    [debouncedRefetch, logDashboardEvent, scheduleMonitoringHoldingsRefresh]
  );

  const handleSubscriptionError = useCallback((source: string, error: unknown) => {
    console.error("subscription error", { source, error });
    logDashboardEvent({
      eventType: "run_issue",
      action: "subscription-error",
      trigger: source,
      error:
        error instanceof Error
          ? { name: error.name, message: error.message }
          : String(error),
    });
    setSseError(true);
  }, [logDashboardEvent]);

  trpc.subscription.onNewTransaction.useSubscription(
    { tokenPublicKey: tokenPublicKey || "" },
    {
      enabled: !!tokenPublicKey && !!tokenData && isMonitoring,
      onData: (event) =>
        handleSubscriptionData("onNewTransaction", event, {
          markActivity: true,
        }),
      onError: (error) => handleSubscriptionError("onNewTransaction", error),
    }
  );

  trpc.subscription.onBalanceUpdate.useSubscription(
    { tokenPublicKey: tokenPublicKey || "" },
    {
      enabled: !!tokenPublicKey && !!tokenData && isMonitoring,
      onData: (event) =>
        handleSubscriptionData("onBalanceUpdate", event, {
          markActivity: true,
        }),
      onError: (error) => handleSubscriptionError("onBalanceUpdate", error),
    }
  );

  trpc.subscription.onTokenBalanceUpdate.useSubscription(
    { tokenPublicKey: tokenPublicKey || "" },
    {
      enabled: !!tokenPublicKey && !!tokenData && isMonitoring,
      onData: (event) =>
        handleSubscriptionData("onTokenBalanceUpdate", event, {
          markActivity: true,
        }),
      onError: (error) => handleSubscriptionError("onTokenBalanceUpdate", error),
    }
  );

  trpc.subscription.onVolumeBotUpdate.useSubscription(
    { tokenPublicKey: tokenPublicKey || "" },
    {
      enabled: !!tokenPublicKey && !!tokenData && isMonitoring,
      onData: (event) =>
        handleSubscriptionData("onVolumeBotUpdate", event, {
          triggerHoldingsRefresh: true,
          markActivity: true,
        }),
      onError: (error) => handleSubscriptionError("onVolumeBotUpdate", error),
    }
  );

  trpc.subscription.onIngestionComplete.useSubscription(
    { tokenPublicKey: tokenPublicKey || "" },
    {
      enabled: !!tokenPublicKey && !!tokenData && isMonitoring,
      onData: (event) =>
        handleSubscriptionData("onIngestionComplete", event, {
          triggerHoldingsRefresh: true,
          markActivity: true,
        }),
      onError: (error) => handleSubscriptionError("onIngestionComplete", error),
    }
  );

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
  const refreshMainBalance = trpc.wallet.refreshMainBalance.useMutation();
  const prevExitStatusRef = useRef<string | null>(null);

  const [fullRefreshing, setFullRefreshing] = useState(false);

  const handleFullRefresh = useCallback(async () => {
    if (!tokenPublicKey) return;
    setFullRefreshing(true);
    logDashboardEvent(
      {
        eventType: "dashboard_refresh",
        action: "handleFullRefresh",
        refreshMode: "full",
        status: "started",
      },
      { trigger: "full-refresh" }
    );
    let hasFailure = false;
    let outcomes: string[] = [];
    try {
      const results = await Promise.allSettled([
        refreshBalances({ tokenPublicKey, force: true }),
        refreshHoldings({ tokenPublicKey }),
        refreshTransactions({ tokenPublicKey }),
      ]);
      outcomes = results.map((result) => result.status);
      hasFailure = results.some((result) => result.status === "rejected");
    } finally {
      refetchToken();
      refetchStats();
      refetchDefi();
      logDashboardEvent({
        eventType: "dashboard_refresh",
        action: "handleFullRefresh",
        refreshMode: "full",
        status: hasFailure ? "failed" : "completed",
        actualValue: {
          outcomes,
        },
      });
      setFullRefreshing(false);
    }
  }, [
    logDashboardEvent,
    tokenPublicKey,
    refreshBalances,
    refreshHoldings,
    refreshTransactions,
    refetchToken,
    refetchStats,
    refetchDefi,
  ]);

  const handleLightRefresh = useCallback(() => {
    logDashboardEvent(
      {
        eventType: "dashboard_refresh",
        action: "handleLightRefresh",
        refreshMode: "light",
        status: "started",
      },
      { trigger: "light-refresh" }
    );
    refetchToken();
    refetchStats();
    refetchDefi();
  }, [logDashboardEvent, refetchDefi, refetchStats, refetchToken]);

  useEffect(() => {
    if (!isMonitoring || !monitoringInitialized) return;
    handleLightRefresh();
    scheduleMonitoringHoldingsRefresh("monitoring-enabled", true);
  }, [
    isMonitoring,
    monitoringInitialized,
    handleLightRefresh,
    scheduleMonitoringHoldingsRefresh,
  ]);

  useEffect(() => {
    if (!isMonitoring || !tokenPublicKey) return;
    const timer = setInterval(() => {
      const now = Date.now();
      const lastActivityAt = lastMonitoringActivityAtRef.current;
      const hasRecentActivity =
        lastActivityAt !== null &&
        now - lastActivityAt <= MONITORING_ACTIVITY_WINDOW_MS;
      const staleHoldings =
        dataUpdatedAt === 0 || now - dataUpdatedAt > HOLDINGS_STALE_THRESHOLD_MS;
      if (hasRecentActivity || staleHoldings) {
        scheduleMonitoringHoldingsRefresh("safety-interval");
      }
    }, MONITORING_HOLDINGS_SAFETY_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [dataUpdatedAt, isMonitoring, scheduleMonitoringHoldingsRefresh, tokenPublicKey]);

  const staleByStats = dataUpdatedAt > 0 && nowMs - dataUpdatedAt > STALE_THRESHOLD_MS;
  const staleByEvents =
    lastSseEventAt !== null && nowMs - lastSseEventAt > STALE_THRESHOLD_MS;
  const monitoringDisabledMessage =
    grpcStatusQuery.data?.accessReason === "not_pro"
      ? "Upgrade to Pro to activate live monitoring. Dashboard will keep polling every 30 seconds."
      : grpcStatusQuery.data?.accessReason === "grpc_disabled" ||
          grpcStatusQuery.data?.accessReason === "grpc_not_configured"
        ? "Live monitoring is currently unavailable. Dashboard will keep polling every 30 seconds."
        : null;
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

  useEffect(() => {
    if (!exitStatus) return;
    const wasRunning =
      prevExitStatusRef.current === "PENDING" ||
      prevExitStatusRef.current === "RUNNING";
    const isTerminal =
      exitStatus !== "PENDING" && exitStatus !== "RUNNING";
    prevExitStatusRef.current = exitStatus;
    if (!wasRunning || !isTerminal) return;
    refetchStats();
    refreshMainBalance.mutateAsync({}).then(() => {
      void refetchStats();
    });
  }, [exitStatus, refetchStats, refreshMainBalance]);

  const walletsWithBalance =
    statsData?.holdingsBreakdown.userWallets.filter(
      (wallet) =>
        Number.isFinite(Number(wallet.tokenBalance)) &&
        Number(wallet.tokenBalance) > 0
    ).length ?? 0;
  const totalWallets = statsData?.holdingsBreakdown.userWallets.length ?? 0;
  const totalBalance = statsData?.holdingsBreakdown.userTotalTokens ?? 0;

  useEffect(() => {
    if (!tokenPublicKey || !testRunLogConfig?.enabled || !testRunLogConfig.runId) return;
    if (typeof window === "undefined") return;
    const storageKey = `test-run-started:${testRunLogConfig.runId}`;
    if (window.sessionStorage.getItem(storageKey) === "true") return;
    window.sessionStorage.setItem(storageKey, "true");
    logDashboardEvent({
      eventType: "run_started",
      action: "dashboard-session-attached",
      status: "started",
      notes: {
        runId: testRunLogConfig.runId,
      },
    });
  }, [logDashboardEvent, testRunLogConfig?.enabled, testRunLogConfig?.runId, tokenPublicKey]);

  useEffect(() => {
    if (!tokenPublicKey || !testRunLogConfig?.enabled || !testRunLogConfig.runId) return;
    if (!activeExitId || !exitStatus || exitStatus === "PENDING" || exitStatus === "RUNNING") {
      return;
    }
    if (typeof window === "undefined") return;
    const storageKey = `test-run-completed:${testRunLogConfig.runId}:${activeExitId}`;
    if (window.sessionStorage.getItem(storageKey) === "true") return;
    window.sessionStorage.setItem(storageKey, "true");
    logDashboardEvent({
      eventType: "run_completed",
      action: "holding-exit-terminal-state",
      status: exitStatus,
      actualValue: exitData,
    });
  }, [
    activeExitId,
    exitData,
    exitStatus,
    logDashboardEvent,
    testRunLogConfig?.enabled,
    testRunLogConfig?.runId,
    tokenPublicKey,
  ]);

  useEffect(() => {
    if (!statsData || !tokenPublicKey || !testRunLogConfig?.enabled) return;
    if (lastLoggedStatsUpdateAtRef.current === dataUpdatedAt) return;
    lastLoggedStatsUpdateAtRef.current = dataUpdatedAt;
    const trigger = lastDashboardTriggerRef.current;
    logDashboardEvent({
      eventType: "dashboard_summary",
      action: "rendered-dashboard-summary",
      trigger,
      summary: buildDashboardSummaryPayload({
        tokenPublicKey,
        statsData,
        monitoringHealthState,
        isMonitoring,
        trigger,
        dataUpdatedAt,
        defiData,
      }),
    });
    if (trigger !== "query-update" && trigger !== "dashboard.debounced-refetch") {
      logDashboardEvent({
        eventType: "dashboard_full_snapshot",
        action: "rendered-dashboard-full-snapshot",
        trigger,
        snapshot: buildDashboardFullSnapshotPayload({
          statsData,
          defiData,
          monitoringHealthState,
          isMonitoring,
        }),
      });
    }
    lastDashboardTriggerRef.current = "query-update";
  }, [
    dataUpdatedAt,
    defiData,
    isMonitoring,
    logDashboardEvent,
    monitoringHealthState,
    statsData,
    testRunLogConfig?.enabled,
    tokenPublicKey,
  ]);

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
          disabledMessage={monitoringDisabledMessage}
          disabledActionHref={
            grpcStatusQuery.data?.accessReason === "not_pro"
              ? ACCOUNT_SUBSCRIPTION_HREF
              : undefined
          }
          disabledActionLabel={
            grpcStatusQuery.data?.accessReason === "not_pro"
              ? "Upgrade to Pro"
              : undefined
          }
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
