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

  const { mutateAsync: refreshTransactions, isPending: isRefreshing } =
    trpc.transaction.refreshByToken.useMutation();

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

  const transactions = transactionsData ?? [];
  const canRefreshAny = transactions.length
    ? transactions.some((transaction) => canRefresh(transaction.updatedAt))
    : true;

  const handleRefresh = async () => {
    if (!tokenPublicKey) return;
    await refreshTransactions({ tokenPublicKey });
    await refetchTransactions();
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex justify-between items-center gap-2 -m-6 px-6 py-10 border-b">
        <div>
          <h1 className="text-4xl">Transactions</h1>
          <p className="text-sm text-muted-foreground">
            Last refresh {formatRelativeTime(transactions[0]?.updatedAt)}
          </p>
        </div>
        <p className="leading-tight font-light text-right text-muted-foreground">
          Review token activity for selected wallets.
          <br />
          Refresh uses the same cadence as wallet balances.
        </p>
      </div>
      <div className="pt-6"/>

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