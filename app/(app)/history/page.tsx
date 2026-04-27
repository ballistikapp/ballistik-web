"use client";

import { useMemo, useState, useCallback } from "react";
import { useQueryState, parseAsInteger, parseAsString } from "nuqs";
import type { PaginationState } from "@tanstack/react-table";
import { IconX } from "@tabler/icons-react";
import { trpc } from "@/lib/trpc/client";
import {
  DataTable,
  DataTablePagination,
  DataTableSearch,
  DataTableViewOptions,
} from "@/components/data-table";
import { PageHeader } from "@/components/layout/sections";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { getColumns } from "./columns";

const ALL = "__all__";

const sourceOptions = [
  { value: "LAUNCH", label: "Launch" },
  { value: "EXIT", label: "Exit" },
  { value: "VOLUME_BOT", label: "Volume Bot" },
  { value: "HOLDING", label: "Holding" },
  { value: "WALLET", label: "Wallet" },
  { value: "BILLING", label: "Billing" },
  { value: "CREATOR_REWARD", label: "Creator Rewards" },
] as const;

const typeGroups = [
  {
    label: "Trade",
    items: [
      { value: "TRADE_BUY", label: "Buy" },
      { value: "TRADE_SELL", label: "Sell" },
      { value: "TRADE_CREATE", label: "Create" },
    ],
  },
  {
    label: "Transfer",
    items: [
      { value: "TRANSFER_FUND", label: "Fund" },
      { value: "TRANSFER_RETURN", label: "Return" },
      { value: "TRANSFER_RECLAIM", label: "Reclaim" },
      { value: "TRANSFER_WITHDRAW", label: "Withdraw" },
    ],
  },
  {
    label: "Fee",
    items: [
      { value: "FEE_USAGE", label: "Platform Fee" },
      { value: "FEE_SUBSCRIPTION", label: "Subscription Fee" },
    ],
  },
  {
    label: "Token",
    items: [
      { value: "TOKEN_DISTRIBUTE", label: "Distribute" },
      { value: "TOKEN_CONSOLIDATE", label: "Consolidate" },
    ],
  },
  {
    label: "Account",
    items: [
      { value: "ACCOUNT_ATA_CREATE", label: "ATA Create" },
      { value: "ACCOUNT_ATA_CLOSE", label: "ATA Close" },
    ],
  },
  {
    label: "Rewards",
    items: [
      { value: "REWARD_CLAIM", label: "Claim Rewards" },
      { value: "REWARD_PAYOUT", label: "Reward Payout" },
    ],
  },
] as const;

const statusOptions = [
  { value: "CONFIRMED", label: "Confirmed" },
  { value: "PENDING", label: "Pending" },
  { value: "FAILED", label: "Failed" },
] as const;

type SourceValue = (typeof sourceOptions)[number]["value"];
type StatusValue = (typeof statusOptions)[number]["value"];
type TypeValue =
  (typeof typeGroups)[number]["items"][number]["value"];

const DEFAULT_PAGE_SIZE = 25;

const queryOpts = { history: "replace" as const, shallow: true };

export default function HistoryPage() {
  const columns = useMemo(() => getColumns(), []);

  const [sourceParam, setSourceParam] = useQueryState(
    "source",
    parseAsString.withOptions(queryOpts)
  );
  const [typeParam, setTypeParam] = useQueryState(
    "type",
    parseAsString.withOptions(queryOpts)
  );
  const [statusParam, setStatusParam] = useQueryState(
    "status",
    parseAsString.withOptions(queryOpts)
  );
  const [searchParam, setSearchParam] = useQueryState(
    "search",
    parseAsString.withOptions(queryOpts)
  );
  const [pageParam, setPageParam] = useQueryState(
    "page",
    parseAsInteger.withDefault(0).withOptions(queryOpts)
  );
  const [pageSizeParam, setPageSizeParam] = useQueryState(
    "pageSize",
    parseAsInteger.withDefault(DEFAULT_PAGE_SIZE).withOptions(queryOpts)
  );

  const [debouncedSearch, setDebouncedSearch] = useState(searchParam ?? "");

  const resetPage = useCallback(() => {
    setPageParam(0);
  }, [setPageParam]);

  const source = (sourceParam as SourceValue) || undefined;
  const type = (typeParam as TypeValue) || undefined;
  const status = (statusParam as StatusValue) || undefined;
  const search = searchParam || undefined;

  const { data, isLoading, isFetching } = trpc.appTransaction.list.useQuery(
    {
      source,
      type,
      status,
      search,
      page: pageParam + 1,
      pageSize: pageSizeParam,
    },
    { placeholderData: (prev) => prev }
  );

  const items = data?.items ?? [];
  const totalCount = data?.totalCount ?? 0;
  const pageCount = Math.max(1, Math.ceil(totalCount / pageSizeParam));

  const pagination: PaginationState = useMemo(
    () => ({ pageIndex: pageParam, pageSize: pageSizeParam }),
    [pageParam, pageSizeParam]
  );

  const handlePaginationChange = useCallback(
    (updater: PaginationState | ((old: PaginationState) => PaginationState)) => {
      const next =
        typeof updater === "function"
          ? updater({ pageIndex: pageParam, pageSize: pageSizeParam })
          : updater;
      setPageParam(next.pageIndex || null);
      setPageSizeParam(
        next.pageSize === DEFAULT_PAGE_SIZE ? null : next.pageSize
      );
    },
    [pageParam, pageSizeParam, setPageParam, setPageSizeParam]
  );

  const hasFilters = !!(sourceParam || typeParam || statusParam || searchParam);

  const clearFilters = useCallback(() => {
    setSourceParam(null);
    setTypeParam(null);
    setStatusParam(null);
    setSearchParam(null);
    setDebouncedSearch("");
    resetPage();
  }, [setSourceParam, setTypeParam, setStatusParam, setSearchParam, resetPage]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="History" />

      <DataTable
        columns={columns}
        data={items}
        isLoading={isLoading}
        isRefreshing={isFetching && !isLoading}
        manualPagination
        pageCount={pageCount}
        rowCount={totalCount}
        initialPagination={{ pageIndex: pageParam, pageSize: pageSizeParam }}
        onPaginationStateChange={handlePaginationChange}
        getRowId={(row) => row.id}
        initialColumnVisibility={{
          tokenAmount: false,
          fromAddress: false,
          toAddress: false,
          bundleId: false,
          errorMessage: false,
          transactionSignature: false,
        }}
        toolbar={(table) => (
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-1 flex-wrap items-center gap-2">
              <DataTableSearch
                table={table}
                value={debouncedSearch}
                onChange={(val) => {
                  setDebouncedSearch(val);
                  setSearchParam(val || null);
                  resetPage();
                }}
                placeholder="Search description, wallet, signature..."
                className="w-full sm:max-w-[280px]"
              />

              <Select
                value={sourceParam ?? ALL}
                onValueChange={(v) => {
                  setSourceParam(v === ALL ? null : v);
                  resetPage();
                }}
              >
                <SelectTrigger className="h-9 w-[140px]">
                  <SelectValue placeholder="All Sources" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>All Sources</SelectItem>
                  {sourceOptions.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select
                value={typeParam ?? ALL}
                onValueChange={(v) => {
                  setTypeParam(v === ALL ? null : v);
                  resetPage();
                }}
              >
                <SelectTrigger className="h-9 w-[160px]">
                  <SelectValue placeholder="All Types" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>All Types</SelectItem>
                  {typeGroups.map((group) => (
                    <SelectGroup key={group.label}>
                      <SelectLabel>{group.label}</SelectLabel>
                      {group.items.map((item) => (
                        <SelectItem key={item.value} value={item.value}>
                          {item.label}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  ))}
                </SelectContent>
              </Select>

              <Select
                value={statusParam ?? ALL}
                onValueChange={(v) => {
                  setStatusParam(v === ALL ? null : v);
                  resetPage();
                }}
              >
                <SelectTrigger className="h-9 w-[140px]">
                  <SelectValue placeholder="All Statuses" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>All Statuses</SelectItem>
                  {statusOptions.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {hasFilters && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={clearFilters}
                  className="h-9 px-2 text-muted-foreground"
                >
                  <IconX className="mr-1 size-4" />
                  Clear
                </Button>
              )}
            </div>

            <DataTableViewOptions table={table} />
          </div>
        )}
        pagination={(table) => (
          <DataTablePagination table={table} showSelectedCount={false} />
        )}
      />
    </div>
  );
}
