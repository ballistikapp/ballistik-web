"use client";

import { useEffect, useMemo, useRef } from "react";
import { useQueryState } from "nuqs";
import { IconRefresh } from "@tabler/icons-react";
import { toast } from "sonner";
import { tokenQueryParser } from "@/lib/utils/token-query";
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

export default function TransactionsPage() {
  const [tokenPublicKey] = useQueryState("token", tokenQueryParser);

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
    data: transactionsData,
    isLoading: transactionsLoading,
    refetch: refetchTransactions,
  } = trpc.transaction.listByToken.useQuery(
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
      await Promise.all([refetchTransactions(), refetchRefreshCache()]);
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
      <div className="flex justify-between items-center gap-2 -m-6 px-6 py-10 border-b">
        <div>
          <h1 className="text-4xl">Transactions</h1>
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
              Last refresh: {formatRefreshTime(refreshTimestamp)}
            </p>
          </div>
        </div>
        <p className="leading-tight font-light text-right text-muted-foreground">
          Review token activity for selected wallets.
          <br />
          Refresh uses the same cadence as wallet balances.
        </p>
      </div>
      <div className="pt-6" />

      <DataTable
        columns={columns}
        data={transactions}
        isLoading={transactionsLoading}
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
