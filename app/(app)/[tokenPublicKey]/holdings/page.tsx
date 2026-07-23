"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@/server/trpc/routers/_app";
import { useParams } from "next/navigation";
import { toast } from "sonner";
import { IconArrowDown, IconCoins, IconRefresh, IconWallet } from "@tabler/icons-react";
import type { PaginationState } from "@tanstack/react-table";
import { trpc } from "@/lib/trpc/client";
import { invalidateTokenSidebarCounts } from "@/lib/trpc/invalidate-token-sidebar-counts";
import { cacheConfig } from "@/lib/config/cache.config";
import { formatRefreshTime } from "@/lib/utils/relative-time";
import { formatSol, formatTokenCount } from "@/lib/utils/format";
import { formatBuyHoldingsToast } from "@/lib/utils/buy-holdings-toast-message";
import { formatSellHoldingsToast } from "@/lib/utils/sell-holdings-toast-message";
import { legacyCapabilityDeniedMessage } from "@/lib/launch/legacy-capability";
import { TokenNotFound } from "@/components/placeholders/token-not-found";
import { DashboardLoading } from "../dashboard/dashboard-loading";
import { HoldingBuyDialog } from "@/components/holdings/holding-buy-dialog";
import { HoldingSellExitDialog } from "@/components/holdings/holding-sell-exit-dialog";
import {
  DataTable,
  DataTablePagination,
  DataTableSearch,
  DataTableViewOptions,
} from "@/components/data-table";
import { PageHeader } from "@/components/layout/sections";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { getColumns } from "./columns";

function formatCompact(value: number) {
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 2,
  }).format(value);
}

const SELL_DIALOG_REFRESH_STALE_MS = 60_000;

function isRefreshStale(
  refreshTimestamp: Date | string | null,
  staleMs: number
) {
  return (
    !refreshTimestamp ||
    Date.now() - new Date(refreshTimestamp).getTime() > staleMs
  );
}

export default function Page() {
  const { tokenPublicKey } = useParams<{ tokenPublicKey: string }>();
  const utils = trpc.useUtils();
  const [rowSelection, setRowSelection] = useState<Record<string, boolean>>({});
  const [buyDialogOpen, setBuyDialogOpen] = useState(false);
  const [sellExitDialogOpen, setSellExitDialogOpen] = useState(false);
  const [sellExitInitialTab, setSellExitInitialTab] = useState<"sell" | "exit">(
    "sell"
  );
  const [sellExitShouldRefreshOnOpen, setSellExitShouldRefreshOnOpen] =
    useState(false);
  const [selectedDialogHoldings, setSelectedDialogHoldings] = useState<
    { walletPublicKey: string; tokenBalance: number }[] | undefined
  >(undefined);
  const [manualExitDialogOpen, setManualExitDialogOpen] = useState(false);
  const [localExitId, setLocalExitId] = useState<string | null>(null);
  const [dismissedExitId, setDismissedExitId] = useState<string | null>(null);
  const [pagination, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: 25,
  });

  const {
    data: tokenData,
    isLoading,
    error,
    refetch,
  } = trpc.token.getByPublicKey.useQuery(
    { publicKey: tokenPublicKey || "" },
    { enabled: !!tokenPublicKey }
  );

  const { data: holdingsData, isLoading: holdingsLoading, isFetching: holdingsFetching } =
    trpc.holding.listByToken.useQuery(
      {
        tokenPublicKey: tokenPublicKey || "",
        page: pagination.pageIndex + 1,
        pageSize: pagination.pageSize,
      },
      {
        enabled: !!tokenPublicKey && !!tokenData,
        placeholderData: (previousData) => previousData,
      }
    );

  const {
    data: refreshCache,
    refetch: refetchRefreshCache,
    isLoading: refreshCacheLoading,
  } = trpc.refreshCache.getByScope.useQuery(
    {
      tokenPublicKey: tokenPublicKey || "",
      scope: "HOLDINGS",
    },
    { enabled: !!tokenPublicKey }
  );

  const { mutateAsync: refreshHoldings, isPending: isRefreshing } =
    trpc.holding.refreshByToken.useMutation();
  const { data: testRunLogConfig } = trpc.testRunLog.getConfig.useQuery(undefined, {
    enabled: !!tokenPublicKey,
  });
  const { data: dashboardStats } = trpc.dashboard.getStats.useQuery(
    { tokenPublicKey: tokenPublicKey || "" },
    { enabled: !!tokenPublicKey && !!tokenData }
  );
  const appendTestRunEvent = trpc.testRunLog.appendEvent.useMutation();
  const { mutateAsync: sellHoldings, isPending: isSelling } =
    trpc.holding.sellByToken.useMutation();
  const { mutateAsync: buyHoldings, isPending: isBuying } =
    trpc.holding.buyByToken.useMutation();
  const { mutateAsync: refreshWalletBalances } =
    trpc.wallet.refreshBalances.useMutation();
  const refreshMainBalance = trpc.wallet.refreshMainBalance.useMutation();
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

  const columns = useMemo(() => {
    if (!tokenPublicKey || !tokenData) return [];
    return getColumns({
      tokenPublicKey,
      tokenSymbol: tokenData.symbol,
      tokenSupply: holdingsData?.totalSupply ?? null,
    });
  }, [holdingsData?.totalSupply, tokenData, tokenPublicKey]);

  const holdings = useMemo(
    () => holdingsData?.holdings ?? [],
    [holdingsData?.holdings]
  );
  const totalCount = holdingsData?.totalCount ?? 0;
  const totalBalance = holdingsData?.totalBalance ?? 0;
  const pageCount = Math.max(1, Math.ceil(totalCount / pagination.pageSize));
  const walletsWithBalance = holdingsData?.walletsWithBalance ?? 0;
  const totalSupply = holdingsData?.totalSupply ?? null;
  const hasHoldings = totalBalance > 0;
  const refreshTimestamp = refreshCache?.lastRefreshedAt ?? null;
  const sellDialogInitialHoldings = useMemo(
    () =>
      holdings.map((holding) => ({
        walletPublicKey: holding.wallet.publicKey,
        tokenBalance: Number(holding.tokenBalance),
      })),
    [holdings]
  );
  const totalSupplyShare =
    totalSupply && totalSupply > 0 ? (totalBalance / totalSupply) * 100 : null;
  const holdingsValueSol = dashboardStats?.metrics.holdingsValue.valueSol ?? null;
  const metricCards = useMemo(
    () => [
      {
        label: "Active Wallets",
        icon: IconWallet,
        value: formatCompact(walletsWithBalance),
        secondary: `${formatCompact(totalCount)} ATAs tracked`,
      },
      {
        label: "Holdings Value",
        icon: IconCoins,
        value:
          holdingsValueSol === null ? "--" : `${formatSol(holdingsValueSol)} SOL`,
        secondary: `${formatTokenCount(totalBalance)} ${tokenData?.symbol ?? "tokens"
          } · ${totalSupplyShare === null ? "--" : `${totalSupplyShare.toFixed(2)}%`
          } supply share`,
      },
    ],
    [
      holdingsValueSol,
      totalCount,
      tokenData?.symbol,
      totalBalance,
      totalSupplyShare,
      walletsWithBalance,
    ]
  );
  const selectedHoldings = useMemo(
    () => holdings.filter((holding) => rowSelection[holding.id]),
    [holdings, rowSelection]
  );
  const autoRefreshTriggered = useRef(false);
  const lastSnapshotKeyRef = useRef<string | null>(null);

  const refreshRelatedWalletData = useCallback(
    async (walletPublicKeys?: string[]) => {
      if (!tokenPublicKey) return;
      await Promise.all([
        refreshWalletBalances({
          tokenPublicKey,
          walletPublicKeys,
          force: true,
        }),
        refreshMainBalance.mutateAsync({}),
      ]);
      await Promise.all([
        utils.wallet.getMain.invalidate(),
        utils.wallet.getOperationalByToken.invalidate({ tokenPublicKey }),
        utils.wallet.getDevByToken.invalidate({ tokenPublicKey }),
      ]);
      invalidateTokenSidebarCounts(utils, tokenPublicKey);
    },
    [
      refreshMainBalance,
      refreshWalletBalances,
      tokenPublicKey,
      utils,
    ]
  );

  const logHoldingsEvent = useCallback(
    (event: Parameters<typeof appendTestRunEvent.mutate>[0]) => {
      if (!tokenPublicKey || !testRunLogConfig?.enabled) return;
      appendTestRunEvent.mutate({
        tokenPublicKey,
        page: "holdings",
        source: "holdings-page",
        ...event,
      });
    },
    [appendTestRunEvent, testRunLogConfig?.enabled, tokenPublicKey]
  );

  const handleRefresh = useCallback(
    async (options?: { showToast?: boolean }) => {
      if (!tokenPublicKey) return;
      logHoldingsEvent({
        eventType: "holdings_refresh",
        action: "refresh",
        status: "started",
      });
      const showToast = options?.showToast !== false;
      const toastId = showToast
        ? toast.loading("Refreshing holdings...", {
          icon: <Spinner className="size-4" />,
        })
        : null;
      try {
        await refreshHoldings({ tokenPublicKey });
        void utils.holding.listByToken.invalidate();
        invalidateTokenSidebarCounts(utils, tokenPublicKey);
        const latestHoldings = await utils.holding.listByToken.fetch({
          tokenPublicKey,
          page: pagination.pageIndex + 1,
          pageSize: pagination.pageSize,
        });
        await refetchRefreshCache();
        logHoldingsEvent({
          eventType: "holdings_refresh",
          action: "refresh",
          status: "completed",
          actualValue: {
            totalCount: latestHoldings.totalCount,
            totalBalance: latestHoldings.totalBalance,
            walletsWithBalance: latestHoldings.walletsWithBalance,
          },
        });
        if (toastId) {
          toast.success("Holdings refreshed", { id: toastId, icon: null });
        }
      } catch (error) {
        logHoldingsEvent({
          eventType: "run_issue",
          action: "holdings-refresh",
          error: error instanceof Error ? error.message : String(error),
        });
        if (toastId) {
          toast.error("Failed to refresh holdings", { id: toastId, icon: null });
        }
      }
    },
    [
      logHoldingsEvent,
      pagination.pageIndex,
      pagination.pageSize,
      refetchRefreshCache,
      refreshHoldings,
      tokenPublicKey,
      utils,
    ]
  );

  const handleSell = async (
    walletPublicKeys: string[],
    sellPercentage: number,
    closeAta: boolean,
    returnSolToMainWallet: boolean
  ) => {
    if (!tokenPublicKey || walletPublicKeys.length === 0) return;
    const toastId = toast.loading("Submitting sell transactions...");
    try {
      const result = await sellHoldings({
        tokenPublicKey,
        walletPublicKeys,
        sellPercentage,
        closeAta,
        returnSolToMainWallet,
      });
      toast.success(formatSellHoldingsToast(result, closeAta), {
        id: toastId,
      });
      await refreshHoldings({ tokenPublicKey, walletPublicKeys });
      await refreshRelatedWalletData(
        result.effectiveReturnSolToMainWallet ? undefined : walletPublicKeys
      );
      logHoldingsEvent({
        eventType: "trade_result",
        action: "sell-from-holdings-page",
        expectedValue: {
          sellPercentage,
          closeAta,
          returnSolToMainWallet,
        },
        actualValue: result,
      });
      void utils.holding.listByToken.invalidate({ tokenPublicKey });
      setSellExitDialogOpen(false);
      setSelectedDialogHoldings(undefined);
    } catch (error) {
      logHoldingsEvent({
        eventType: "run_issue",
        action: "holdings-sell",
        error: error instanceof Error ? error.message : String(error),
      });
      const message =
        error instanceof Error ? error.message : "Failed to submit sells";
      toast.error(message, { id: toastId });
    }
  };

  const handleBuy = async (
    walletPublicKeys: string[],
    solAmountPerWallet: number,
    slippageBps: number
  ) => {
    if (!tokenPublicKey || walletPublicKeys.length === 0) return;
    const toastId = toast.loading("Submitting buy transactions...");
    try {
      const result = await buyHoldings({
        tokenPublicKey,
        walletPublicKeys,
        solAmountPerWallet,
        slippageBps,
      });
      toast.success(formatBuyHoldingsToast(result), {
        id: toastId,
      });
      await refreshHoldings({ tokenPublicKey, walletPublicKeys });
      await refreshRelatedWalletData(walletPublicKeys);
      logHoldingsEvent({
        eventType: "trade_result",
        action: "buy-from-holdings-page",
        expectedValue: {
          solAmountPerWallet,
          slippageBps,
        },
        actualValue: result,
      });
      void utils.holding.listByToken.invalidate({ tokenPublicKey });
      setBuyDialogOpen(false);
    } catch (error) {
      logHoldingsEvent({
        eventType: "run_issue",
        action: "holdings-buy",
        error: error instanceof Error ? error.message : String(error),
      });
      const message =
        error instanceof Error ? error.message : "Failed to submit buys";
      toast.error(message, { id: toastId });
    }
  };

  const handleExit = async (
    jitoTipSol: number,
    returnSolToMainWallet: boolean
  ) => {
    if (!tokenPublicKey) return;
    const toastId = toast.loading("Starting exit...");
    try {
      const result = await startExitMutation.mutateAsync({
        tokenPublicKey,
        jitoTipSol,
        returnSolToMainWallet,
      });
      setLocalExitId(result.exitId);
      setManualExitDialogOpen(true);
      setDismissedExitId(null);
      void utils.activeProcess.list.invalidate();
      toast.success("Exit started", { id: toastId });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to start exit";
      toast.error(message, { id: toastId });
    }
  };

  const handleCancelExit = async () => {
    if (!activeExitId) return;
    const toastId = toast.loading("Cancelling exit...");
    try {
      await cancelExitMutation.mutateAsync({ exitId: activeExitId });
      toast.success("Exit cancelled", { id: toastId });
      await exitStatusQuery.refetch();
      void utils.activeProcess.list.invalidate();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to cancel exit";
      toast.error(message, { id: toastId });
    }
  };

  const exitData = exitStatusQuery.data ?? activeExitQuery.data ?? null;
  const exitStatus = exitData?.status;
  const shouldAutoOpen =
    Boolean(activeExitId) && dismissedExitId !== activeExitId;
  const isExitDialogOpen = manualExitDialogOpen || shouldAutoOpen;

  type ExitStatus = NonNullable<inferRouterOutputs<AppRouter>["holding"]["exitStatus"]>["status"];
  const prevExitStatusRef = useRef<ExitStatus | null>(null);
  useEffect(() => {
    if (!exitStatus) return;
    const wasRunning =
      prevExitStatusRef.current === "PENDING" ||
      prevExitStatusRef.current === "RUNNING";
    const isTerminal =
      exitStatus !== "PENDING" && exitStatus !== "RUNNING";
    prevExitStatusRef.current = exitStatus;
    if (!wasRunning || !isTerminal) return;
    void (async () => {
      try {
        await handleRefresh({ showToast: false });
        await refreshRelatedWalletData();
      } catch {
        toast.error("Exit finished, but wallet balances could not be refreshed");
      }
    })();
  }, [exitStatus, handleRefresh, refreshRelatedWalletData]);

  const handleSellExitDialogOpenChange = (open: boolean) => {
    setSellExitDialogOpen(open);
    setManualExitDialogOpen(open);
    if (open) {
      setDismissedExitId(null);
      return;
    }
    setSelectedDialogHoldings(undefined);
    if (activeExitId) {
      setDismissedExitId(activeExitId);
    }
    if (activeExitId && exitStatus && exitStatus !== "RUNNING") {
      setLocalExitId(null);
    }
  };

  useEffect(() => {
    if (!tokenPublicKey || !tokenData) return;
    if (refreshCacheLoading) return;
    if (isRefreshing) return;
    const isStale =
      !refreshTimestamp ||
      Date.now() - new Date(refreshTimestamp).getTime() >=
      cacheConfig.staleMs.holdings;
    if (!isStale) return;
    if (autoRefreshTriggered.current) return;
    autoRefreshTriggered.current = true;
    void handleRefresh({ showToast: false });
  }, [
    handleRefresh,
    isRefreshing,
    refreshCacheLoading,
    refreshTimestamp,
    tokenData,
    tokenPublicKey,
  ]);

  useEffect(() => {
    if (!tokenPublicKey || !holdingsData || !testRunLogConfig?.enabled) return;
    const snapshotKey = [
      pagination.pageIndex,
      pagination.pageSize,
      holdingsData.totalCount,
      holdingsData.totalBalance,
      refreshTimestamp ?? "none",
    ].join(":");
    if (lastSnapshotKeyRef.current === snapshotKey) return;
    lastSnapshotKeyRef.current = snapshotKey;
    logHoldingsEvent({
      eventType: "holdings_page_snapshot",
      action: "rendered-holdings-page",
      summary: {
        pageIndex: pagination.pageIndex,
        pageSize: pagination.pageSize,
        totalCount: holdingsData.totalCount,
        totalBalance: holdingsData.totalBalance,
        totalSupply: holdingsData.totalSupply,
        walletsWithBalance: holdingsData.walletsWithBalance,
        refreshTimestamp,
      },
      snapshot: {
        holdings: holdingsData.holdings,
        metricCards,
      },
    });
  }, [
    holdingsData,
    logHoldingsEvent,
    metricCards,
    pagination.pageIndex,
    pagination.pageSize,
    refreshTimestamp,
    testRunLogConfig?.enabled,
    tokenPublicKey,
    walletsWithBalance,
  ]);

  if (isLoading) {
    return <DashboardLoading />;
  }

  if (!tokenData) {
    return <TokenNotFound error={error} onRetry={() => refetch()} />;
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Holdings"
        rightContent={
          <div className="flex w-full flex-col items-start gap-1 md:items-end">
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleRefresh()}
              disabled={isRefreshing || !tokenPublicKey}
            >
              {isRefreshing ? (
                <Spinner className="mr-2 size-4" />
              ) : (
                <IconRefresh className="mr-2 size-4" />
              )}
              Refresh
            </Button>
            <p className="text-sm text-muted-foreground">
              Last refresh {formatRefreshTime(refreshTimestamp)}
            </p>
          </div>
        }
      />

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        {metricCards.map((metric) => {
          const Icon = metric.icon;
          return (
            <div
              key={metric.label}
              className="rounded-xl border border-border/70 bg-card px-4 py-3 shadow-sm"
            >
              <p className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-muted-foreground">
                <Icon className="size-4" />
                {metric.label}
              </p>
              <p className="mt-1 text-xl font-semibold tabular-nums">
                {metric.value}
              </p>
              <p className="mt-1 text-xs text-muted-foreground tabular-nums">
                {metric.secondary}
              </p>
            </div>
          );
        })}
        <div className="flex h-full w-full flex-col items-stretch justify-center gap-2 max-md:mx-auto max-md:flex-row md:ml-auto md:max-w-44">
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="block w-full min-w-0 max-md:flex-1">
                <Button
                  variant="outline"
                  size="lg"
                  className="w-full min-w-0 max-md:flex-1 px-4 text-base font-semibold"
                  type="button"
                  onClick={() => setBuyDialogOpen(true)}
                  disabled={
                    isBuying || !tokenPublicKey || Boolean(tokenData.isLegacy)
                  }
                >
                  <span className="flex-1 text-center text-primary">BUY</span>
                  <IconCoins data-icon="inline-end" className="text-primary" />
                </Button>
              </span>
            </TooltipTrigger>
            {tokenData.isLegacy ? (
              <TooltipContent side="left" sideOffset={4}>
                {legacyCapabilityDeniedMessage("new buys")}
              </TooltipContent>
            ) : null}
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="block w-full min-w-0 max-md:flex-1">
                <Button
                  variant="outline"
                  size="lg"
                  className="w-full min-w-0 max-md:flex-1 px-4 text-base font-semibold"
                  onClick={() => {
                    setSellExitInitialTab("sell");
                    setSelectedDialogHoldings(undefined);
                    setSellExitShouldRefreshOnOpen(
                      isRefreshStale(
                        refreshTimestamp,
                        SELL_DIALOG_REFRESH_STALE_MS
                      )
                    );
                    setSellExitDialogOpen(true);
                  }}
                  disabled={!hasHoldings || isSelling}
                >
                  <span className="flex-1 text-center text-destructive">SELL</span>
                  <IconArrowDown data-icon="inline-end" className="text-destructive" />
                </Button>
              </span>
            </TooltipTrigger>
            {!hasHoldings ? (
              <TooltipContent side="left" sideOffset={4}>
                No holdings available to sell.
              </TooltipContent>
            ) : null}
          </Tooltip>
        </div>
      </div>

      <DataTable
        columns={columns}
        data={holdings}
        isLoading={holdingsLoading}
        isRefreshing={holdingsFetching}
        manualPagination
        pageCount={pageCount}
        rowCount={totalCount}
        onPaginationStateChange={setPagination}
        getRowId={(row) => row.id}
        enableRowSelection
        onRowSelectionChange={setRowSelection}
        enableUrlState
        urlStatePrefix="holdings"
        searchableColumns={["walletPublicKey", "walletType"]}
        toolbar={(table) => (
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <DataTableSearch
              table={table}
              placeholder="Search holdings..."
              className="w-full sm:max-w-sm"
            />
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setSellExitInitialTab("sell");
                  setSellExitShouldRefreshOnOpen(false);
                  setSelectedDialogHoldings(
                    selectedHoldings.map((holding) => ({
                      walletPublicKey: holding.wallet.publicKey,
                      tokenBalance: Number(holding.tokenBalance),
                    }))
                  );
                  setSellExitDialogOpen(true);
                }}
                disabled={selectedHoldings.length === 0 || isSelling}
              >
                Sell Selected
              </Button>
              <DataTableViewOptions table={table} />
            </div>
          </div>
        )}
        pagination={(table) => <DataTablePagination table={table} />}
      />

      <HoldingSellExitDialog
        open={sellExitDialogOpen || isExitDialogOpen}
        onOpenChange={handleSellExitDialogOpenChange}
        tokenPublicKey={tokenPublicKey}
        tokenSymbol={tokenData.symbol}
        initialTab={
          isExitDialogOpen && !sellExitDialogOpen ? "exit" : sellExitInitialTab
        }
        initialHoldings={sellDialogInitialHoldings}
        selectedHoldings={selectedDialogHoldings}
        shouldRefreshOnOpen={sellExitShouldRefreshOnOpen}
        exit={exitData}
        totalWallets={totalCount}
        walletsWithBalance={walletsWithBalance}
        totalBalance={totalBalance}
        isSelling={isSelling}
        isStartingExit={startExitMutation.isPending}
        isCancellingExit={cancelExitMutation.isPending}
        onSell={handleSell}
        onExit={handleExit}
        onCancelExit={handleCancelExit}
        onHoldingsRefreshed={() => {
          void refetchRefreshCache();
          void utils.holding.listByToken.invalidate({ tokenPublicKey });
          invalidateTokenSidebarCounts(utils, tokenPublicKey);
        }}
      />
      <HoldingBuyDialog
        open={buyDialogOpen}
        onOpenChange={setBuyDialogOpen}
        tokenPublicKey={tokenPublicKey}
        tokenSymbol={tokenData.symbol}
        isBuying={isBuying}
        onBuy={handleBuy}
      />
    </div>
  );
}
