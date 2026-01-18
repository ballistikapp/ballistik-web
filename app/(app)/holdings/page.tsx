"use client";

import { useMemo } from "react";
import { useQueryState } from "nuqs";
import { formatDistanceToNowStrict } from "date-fns";
import { tokenQueryParser } from "@/lib/utils/token-query";
import { trpc } from "@/lib/trpc/client";
import { TokenNotFound } from "@/components/placeholders/token-not-found";
import { DashboardLoading } from "../dashboard/dashboard-loading";
import {
  DataTable,
  DataTablePagination,
  DataTableSearch,
  DataTableViewOptions,
} from "@/components/data-table";
import { Button } from "@/components/ui/button";
import { getColumns } from "./columns";

function formatRelativeTime(dateValue?: Date | string | null) {
  if (!dateValue) return "Never";
  const date = typeof dateValue === "string" ? new Date(dateValue) : dateValue;
  if (Number.isNaN(date.getTime())) return "Never";
  return `${formatDistanceToNowStrict(date)} ago`;
}

function canRefresh(dateValue?: Date | string | null) {
  if (!dateValue) return true;
  const date = typeof dateValue === "string" ? new Date(dateValue) : dateValue;
  if (Number.isNaN(date.getTime())) return true;
  return Date.now() - date.getTime() >= 15_000;
}

export default function Page() {
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
    data: holdingsData,
    isLoading: holdingsLoading,
    refetch: refetchHoldings,
  } = trpc.holding.listByToken.useQuery(
    { tokenPublicKey: tokenPublicKey || "" },
    { enabled: !!tokenPublicKey && !!tokenData }
  );

  const { mutateAsync: refreshHoldings, isPending: isRefreshing } =
    trpc.holding.refreshByToken.useMutation();

  const columns = useMemo(() => {
    if (!tokenPublicKey || !tokenData) return [];
    return getColumns({
      tokenPublicKey,
      tokenSymbol: tokenData.symbol,
    });
  }, [tokenData, tokenPublicKey]);

  if (isLoading) {
    return <DashboardLoading />;
  }

  if (!tokenData) {
    return <TokenNotFound error={error} onRetry={() => refetch()} />;
  }

  const holdings = holdingsData ?? [];
  const canRefreshAny = holdings.length
    ? holdings.some((holding) => canRefresh(holding.lastUpdated))
    : true;

  const handleRefresh = async () => {
    if (!tokenPublicKey) return;
    await refreshHoldings({ tokenPublicKey });
    await refetchHoldings();
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex justify-between items-center gap-2 -m-6 px-6 py-10 border-b">
        <div>
          <h1 className="text-4xl">Holdings</h1>
          <p className="text-sm text-muted-foreground">
            Last refresh {formatRelativeTime(holdings[0]?.lastUpdated)}
          </p>
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
                variant="outline"
                size="sm"
                onClick={handleRefresh}
                disabled={isRefreshing || !canRefreshAny}
              >
                Refresh
              </Button>
              <DataTableViewOptions table={table} />
            </div>
          </div>
        )}
        pagination={(table) => <DataTablePagination table={table} />}
      />
    </div>
  );
}
