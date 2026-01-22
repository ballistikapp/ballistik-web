"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryState } from "nuqs";
import { toast } from "sonner";
import { IconRefresh } from "@tabler/icons-react";
import { tokenQueryParser } from "@/lib/utils/token-query";
import { trpc } from "@/lib/trpc/client";
import { cacheConfig } from "@/lib/config/cache.config";
import { formatRefreshTime } from "@/lib/utils/relative-time";
import { TokenNotFound } from "@/components/placeholders/token-not-found";
import { DashboardLoading } from "../dashboard/dashboard-loading";
import { HoldingSellDialog } from "@/components/holdings/holding-sell-dialog";
import { HoldingExitDialog } from "@/components/holdings/holding-exit-dialog";
import {
  DataTable,
  DataTablePagination,
  DataTableSearch,
  DataTableViewOptions,
} from "@/components/data-table";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { getColumns } from "./columns";

export default function Page() {
  const [tokenPublicKey] = useQueryState("token", tokenQueryParser);
  const [rowSelection, setRowSelection] = useState<Record<string, boolean>>({});
  const [sellDialogOpen, setSellDialogOpen] = useState(false);
  const [exitDialogOpen, setExitDialogOpen] = useState(false);
  const [activeExitId, setActiveExitId] = useState<string | null>(null);

  const {
    data: tokenData,
    isLoading,
    error,
    refetch,
  } = trpc.token.getByPublicKey.useQuery(
    { publicKey: tokenPublicKey || "" },
    { enabled: !!tokenPublicKey }
  );

  const {
    data: holdingsData,
    isLoading: holdingsLoading,
    refetch: refetchHoldings,
  } = trpc.holding.listByToken.useQuery(
    { tokenPublicKey: tokenPublicKey || "" },
    { enabled: !!tokenPublicKey && !!tokenData }
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
  const { mutateAsync: sellHoldings, isPending: isSelling } =
    trpc.holding.sellByToken.useMutation();
  const startExitMutation = trpc.holding.startExit.useMutation();
  const cancelExitMutation = trpc.holding.cancelExit.useMutation();
  const activeExitQuery = trpc.holding.getActiveExit.useQuery(
    { tokenPublicKey: tokenPublicKey || "" },
    { enabled: !!tokenPublicKey }
  );
  const exitStatusQuery = trpc.holding.exitStatus.useQuery(
    { exitId: activeExitId ?? "" },
    {
      enabled: Boolean(activeExitId),
      refetchInterval: (query) => {
        const exit = query.state.data;
        if (!exit) return 2000;
        return exit.status === "PENDING" || exit.status === "RUNNING" ? 2000 : false;
      },
    }
  );

  const columns = useMemo(() => {
    if (!tokenPublicKey || !tokenData) return [];
    return getColumns({
      tokenPublicKey,
      tokenSymbol: tokenData.symbol,
    });
  }, [tokenData, tokenPublicKey]);

  const holdings = holdingsData ?? [];
  const totalBalance = useMemo(
    () =>
      holdings.reduce(
        (sum, holding) =>
          sum + (Number.isFinite(Number(holding.tokenBalance)) ? Number(holding.tokenBalance) : 0),
        0
      ),
    [holdings]
  );
  const selectedHoldings = useMemo(
    () => holdings.filter((holding) => rowSelection[holding.walletPublicKey]),
    [holdings, rowSelection]
  );
  const refreshTimestamp = refreshCache?.lastRefreshedAt ?? null;
  const isStale =
    !refreshTimestamp ||
    Date.now() - new Date(refreshTimestamp).getTime() >=
      cacheConfig.staleMs.holdings;
  const autoRefreshTriggered = useRef(false);

  const handleRefresh = async (options?: { showToast?: boolean }) => {
    if (!tokenPublicKey) return;
    const showToast = options?.showToast !== false;
    const toastId = showToast
      ? toast.loading("Refreshing holdings...", {
          icon: <Spinner className="size-4" />,
        })
      : null;
    try {
      await refreshHoldings({ tokenPublicKey });
      await Promise.all([refetchHoldings(), refetchRefreshCache()]);
      if (toastId) {
        toast.success("Holdings refreshed", { id: toastId, icon: null });
      }
    } catch (error) {
      if (toastId) {
        toast.error("Failed to refresh holdings", { id: toastId, icon: null });
      }
    }
  };

  const handleSell = async (sellPercentage: number) => {
    if (!tokenPublicKey || selectedHoldings.length === 0) return;
    const walletPublicKeys = selectedHoldings.map(
      (holding) => holding.wallet.publicKey
    );
    const toastId = toast.loading("Submitting sell transactions...");
    try {
      const result = await sellHoldings({
        tokenPublicKey,
        walletPublicKeys,
        sellPercentage,
      });
      const summary = `${result.submitted} submitted, ${result.failed} failed`;
      toast.success(`Sell submitted: ${summary}`, { id: toastId });
      await refreshHoldings({ tokenPublicKey, walletPublicKeys });
      await refetchHoldings();
      setSellDialogOpen(false);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to submit sells";
      toast.error(message, { id: toastId });
    }
  };

  const handleExit = async (jitoTipSol: number) => {
    if (!tokenPublicKey) return;
    const toastId = toast.loading("Starting exit...");
    try {
      const result = await startExitMutation.mutateAsync({
        tokenPublicKey,
        jitoTipSol,
      });
      setActiveExitId(result.exitId);
      setExitDialogOpen(true);
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
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to cancel exit";
      toast.error(message, { id: toastId });
    }
  };

  useEffect(() => {
    if (!activeExitId && activeExitQuery.data) {
      setActiveExitId(activeExitQuery.data.id);
      setExitDialogOpen(true);
    }
  }, [activeExitId, activeExitQuery.data]);

  const exitData = exitStatusQuery.data ?? activeExitQuery.data ?? null;
  const exitStatus = exitData?.status;

  useEffect(() => {
    if (!tokenPublicKey || !tokenData) return;
    if (refreshCacheLoading) return;
    if (!isStale || isRefreshing) return;
    if (autoRefreshTriggered.current) return;
    autoRefreshTriggered.current = true;
    void handleRefresh({ showToast: false });
  }, [isRefreshing, isStale, refreshCacheLoading, tokenData, tokenPublicKey]);

  if (isLoading) {
    return <DashboardLoading />;
  }

  if (!tokenData) {
    return <TokenNotFound error={error} onRetry={() => refetch()} />;
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex justify-between items-center gap-2 -m-6 px-6 py-10 border-b">
        <div>
          <h1 className="text-4xl">Holdings</h1>
          <div className="mt-3 flex items-center gap-3">
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
        </div>
        <p className="leading-tight font-light text-right text-muted-foreground">
          View token holdings across wallets.
          <br />
          Holdings refresh mirrors wallet balance updates.
        </p>
      </div>

      <div className="pt-6"/>

      <DataTable
        columns={columns}
        data={holdings}
        isLoading={holdingsLoading}
        getRowId={(row) => row.walletPublicKey}
        enableRowSelection
        onRowSelectionChange={setRowSelection}
        enableUrlState
        urlStatePrefix="holdings"
        searchableColumns={["walletPublicKey", "walletType"]}
        toolbar={(table) => (
          <div className="flex items-center justify-between gap-2">
            <DataTableSearch
              table={table}
              placeholder="Search holdings..."
              className="max-w-sm"
            />
            <div className="flex items-center gap-2">
              <Button
                variant="destructive"
                size="sm"
                onClick={() => setSellDialogOpen(true)}
                disabled={selectedHoldings.length === 0 || isSelling}
              >
                Sell
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setExitDialogOpen(true)}
                disabled={startExitMutation.isPending || exitStatus === "RUNNING"}
              >
                Exit
              </Button>
              <DataTableViewOptions table={table} />
            </div>
          </div>
        )}
        pagination={(table) => <DataTablePagination table={table} />}
      />

      <HoldingSellDialog
        open={sellDialogOpen}
        onOpenChange={setSellDialogOpen}
        holdings={selectedHoldings.map((holding) => ({
          walletPublicKey: holding.wallet.publicKey,
          tokenBalance: Number(holding.tokenBalance),
        }))}
        tokenSymbol={tokenData.symbol}
        isSubmitting={isSelling}
        onConfirm={handleSell}
      />
      <HoldingExitDialog
        open={exitDialogOpen}
        onOpenChange={(open) => {
          setExitDialogOpen(open);
          if (!open && exitStatus && exitStatus !== "RUNNING") {
            setActiveExitId(null);
          }
        }}
        exit={exitData}
        tokenSymbol={tokenData.symbol}
        totalWallets={holdings.length}
        totalBalance={totalBalance}
        isSubmitting={startExitMutation.isPending}
        isCancelling={cancelExitMutation.isPending}
        onConfirm={handleExit}
        onCancel={handleCancelExit}
      />
    </div>
  );
}
