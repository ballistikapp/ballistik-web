"use client";
import { useEffect, useMemo, useRef } from "react";
import { useParams } from "next/navigation";
import { IconRefresh } from "@tabler/icons-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc/client";
import { cacheConfig } from "@/lib/config/cache.config";
import { formatRefreshTime } from "@/lib/utils/relative-time";
import { TokenNotFound } from "@/components/placeholders/token-not-found";
import { DashboardLoading } from "../dashboard/dashboard-loading";
import {
  DataTable,
  DataTablePagination,
  DataTableSearch,
  DataTableViewOptions,
} from "@/components/data-table";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { getColumns } from "./columns";

function formatCompact(value: number) {
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 2,
  }).format(value);
}

function formatSol(value: number) {
  return value.toFixed(2);
}

function formatSplit(owned: string, external: string) {
  return `Owned ${owned} · External ${external}`;
}

export default function TransactionsPage() {
  const { tokenPublicKey } = useParams<{ tokenPublicKey: string }>();
  const utils = trpc.useUtils();

  const {
    data: tokenData,
    isLoading,
    error,
    refetch,
  } = trpc.token.getByPublicKey.useQuery(
    { publicKey: tokenPublicKey || "" },
    { enabled: !!tokenPublicKey }
  );

  const { data: transactionsData, isLoading: transactionsLoading } =
    trpc.transaction.listByToken.useQuery(
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
      scope: "TRANSACTIONS",
    },
    { enabled: !!tokenPublicKey }
  );

  const { mutateAsync: refreshTransactions, isPending: isRefreshing } =
    trpc.transaction.refreshByToken.useMutation();

  const columns = useMemo(() => {
    if (!tokenPublicKey || !tokenData) return [];
    return getColumns({
      tokenPublicKey,
      tokenSymbol: tokenData.symbol,
    });
  }, [tokenData, tokenPublicKey]);

  const transactions = transactionsData ?? [];
  const refreshTimestamp = refreshCache?.lastRefreshedAt ?? null;
  const autoRefreshTriggered = useRef(false);
  const metrics = useMemo(() => {
    const buyRows = transactions.filter((tx) => tx.transactionType === "BUY");
    const sellRows = transactions.filter((tx) => tx.transactionType === "SELL");
    const volumeRows = transactions.filter(
      (tx) => tx.transactionType === "BUY" || tx.transactionType === "SELL"
    );

    const ownedBuys = buyRows.filter((tx) => tx.isOwned).length;
    const externalBuys = buyRows.length - ownedBuys;
    const ownedSells = sellRows.filter((tx) => tx.isOwned).length;
    const externalSells = sellRows.length - ownedSells;

    const ownedVolume = volumeRows
      .filter((tx) => tx.isOwned)
      .reduce((sum, tx) => sum + Number(tx.solAmount), 0);
    const externalVolume = volumeRows
      .filter((tx) => !tx.isOwned)
      .reduce((sum, tx) => sum + Number(tx.solAmount), 0);

    const ownedTraders = new Set(
      transactions.filter((tx) => tx.isOwned).map((tx) => tx.walletPublicKey)
    ).size;
    const externalTraders = new Set(
      transactions.filter((tx) => !tx.isOwned).map((tx) => tx.walletPublicKey)
    ).size;

    return {
      buys: { total: buyRows.length, owned: ownedBuys, external: externalBuys },
      sells: {
        total: sellRows.length,
        owned: ownedSells,
        external: externalSells,
      },
      volume: {
        total: ownedVolume + externalVolume,
        owned: ownedVolume,
        external: externalVolume,
      },
      traders: {
        total: ownedTraders + externalTraders,
        owned: ownedTraders,
        external: externalTraders,
      },
    };
  }, [transactions]);
  const metricCards = useMemo(
    () => [
      {
        label: "Buys",
        value: formatCompact(metrics.buys.total),
        split: formatSplit(
          formatCompact(metrics.buys.owned),
          formatCompact(metrics.buys.external)
        ),
      },
      {
        label: "Sells",
        value: formatCompact(metrics.sells.total),
        split: formatSplit(
          formatCompact(metrics.sells.owned),
          formatCompact(metrics.sells.external)
        ),
      },
      {
        label: "Volume",
        value: `${formatSol(metrics.volume.total)} SOL`,
        split: formatSplit(
          `${formatSol(metrics.volume.owned)} SOL`,
          `${formatSol(metrics.volume.external)} SOL`
        ),
      },
      {
        label: "Traders",
        value: formatCompact(metrics.traders.total),
        split: formatSplit(
          formatCompact(metrics.traders.owned),
          formatCompact(metrics.traders.external)
        ),
      },
    ],
    [metrics]
  );

  const handleRefresh = async (options?: { showToast?: boolean }) => {
    if (!tokenPublicKey) return;
    const showToast = options?.showToast !== false;
    const toastId = showToast
      ? toast.loading("Refreshing transactions...", {
          icon: <Spinner className="size-4" />,
        })
      : null;
    try {
      await refreshTransactions({ tokenPublicKey });
      void utils.transaction.listByToken.invalidate({ tokenPublicKey });
      await refetchRefreshCache();
      if (toastId) {
        toast.success("Transactions refreshed", { id: toastId, icon: null });
      }
    } catch (error) {
      if (toastId) {
        toast.error("Failed to refresh transactions", {
          id: toastId,
          icon: null,
        });
      }
    }
  };

  useEffect(() => {
    if (!tokenPublicKey || !tokenData) return;
    if (refreshCacheLoading) return;
    if (isRefreshing) return;
    const isStale =
      !refreshTimestamp ||
      Date.now() - new Date(refreshTimestamp).getTime() >=
        cacheConfig.staleMs.transactions;
    if (!isStale) return;
    if (autoRefreshTriggered.current) return;
    autoRefreshTriggered.current = true;
    void handleRefresh({ showToast: false });
  }, [
    isRefreshing,
    refreshCacheLoading,
    refreshTimestamp,
    tokenData,
    tokenPublicKey,
  ]);

  if (isLoading) {
    return <DashboardLoading />;
  }

  if (!tokenData) {
    return <TokenNotFound error={error} onRetry={() => refetch()} />;
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="-m-6 px-6 py-10 border-b">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-4xl">Transactions</h1>
          </div>
          <div className="flex flex-col items-end gap-1">
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
              Last refresh: {formatRefreshTime(refreshTimestamp)}
            </p>
          </div>
        </div>
      </div>

      <div />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {metricCards.map((metric) => (
          <div
            key={metric.label}
            className="rounded-xl border border-border/70 bg-card px-4 py-3 shadow-sm"
          >
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
              {metric.label}
            </p>
            <p className="mt-1 text-xl font-semibold tabular-nums">{metric.value}</p>
            <p className="mt-1 text-xs text-muted-foreground/90">{metric.split}</p>
          </div>
        ))}
      </div>

      <DataTable
        columns={columns}
        data={transactions}
        isLoading={transactionsLoading}
        initialColumnVisibility={{ status: false }}
        enableUrlState
        urlStatePrefix="transactions"
        searchableColumns={["walletPublicKey", "walletType"]}
        toolbar={(table) => (
          <div className="flex items-center justify-between gap-2">
            <DataTableSearch
              table={table}
              placeholder="Search transactions..."
              className="max-w-sm"
            />
            <DataTableViewOptions table={table} />
          </div>
        )}
        pagination={(table) => <DataTablePagination table={table} />}
      />
    </div>
  );
}
