"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { parseAsStringEnum, useQueryState } from "nuqs";
import type { ColumnDef } from "@tanstack/react-table";
import type { inferRouterOutputs } from "@trpc/server";
import {
  DataTable,
  DataTableColumnHeader,
  DataTablePagination,
  DataTableSearch,
  useDataTableParams,
} from "@/components/data-table";
import { cn } from "@/lib/utils";
import { trpc } from "@/lib/trpc/client";
import type { AppRouter } from "@/server/trpc/routers/_app";

type OpsMarketerRow =
  inferRouterOutputs<AppRouter>["ops"]["listMarketers"]["items"][number];

const ENABLED_FILTERS = ["all", "enabled", "disabled"] as const;

function formatDate(value: Date | string | null | undefined) {
  if (!value) return "—";
  return new Date(value).toLocaleString();
}

function formatRate(value: number) {
  return `${(value * 100).toFixed(2)}%`;
}

const columns: ColumnDef<OpsMarketerRow>[] = [
  {
    accessorKey: "nickname",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="nickname" />
    ),
    cell: ({ row }) => row.original.nickname,
  },
  {
    accessorKey: "userName",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="user" />
    ),
    enableSorting: false,
    cell: ({ row }) => (
      <div className="flex flex-col gap-0.5">
        <span>{row.original.userName}</span>
        <span className="text-muted-foreground font-mono text-xs break-all">
          {row.original.userId}
        </span>
      </div>
    ),
  },
  {
    accessorKey: "feeShareRate",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="fee share" />
    ),
    cell: ({ row }) => formatRate(row.original.feeShareRate),
  },
  {
    accessorKey: "isEnabled",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="status" />
    ),
    cell: ({ row }) => (
      <span
        className={cn(
          "text-xs font-medium",
          row.original.isEnabled
            ? "text-foreground"
            : "text-muted-foreground"
        )}
      >
        {row.original.isEnabled ? "Enabled" : "Disabled"}
      </span>
    ),
  },
  {
    id: "hasReferralCode",
    accessorFn: (row) => row.hasReferralCode,
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="code" />
    ),
    enableSorting: false,
    cell: ({ row }) => (row.original.hasReferralCode ? "Set" : "—"),
  },
  {
    id: "hasFeeCollector",
    accessorFn: (row) => row.hasFeeCollector,
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="collector" />
    ),
    enableSorting: false,
    cell: ({ row }) => (row.original.hasFeeCollector ? "Set" : "—"),
  },
  {
    accessorKey: "createdAt",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="created" />
    ),
    cell: ({ row }) => formatDate(row.original.createdAt),
  },
];

const SORTABLE = new Set([
  "createdAt",
  "nickname",
  "feeShareRate",
  "isEnabled",
]);

export function OpsMarketersTable() {
  const router = useRouter();
  const { pagination, sorting, globalFilter } = useDataTableParams({
    defaultPageSize: 25,
    defaultSort: "createdAt:desc",
    prefix: "marketers",
  });

  const [enabledFilter, setEnabledFilter] = useQueryState(
    "marketers_enabled",
    parseAsStringEnum([...ENABLED_FILTERS])
      .withDefault("all")
      .withOptions({ history: "replace", shallow: true })
  );

  const sortId = sorting[0]?.id;
  const sortBy =
    sortId && SORTABLE.has(sortId)
      ? (sortId as "createdAt" | "nickname" | "feeShareRate" | "isEnabled")
      : "createdAt";
  const sortDir = sorting[0] ? (sorting[0].desc ? "desc" : "asc") : "desc";

  const isEnabled =
    enabledFilter === "enabled"
      ? true
      : enabledFilter === "disabled"
        ? false
        : undefined;

  const { data, isLoading, isFetching, error } = trpc.ops.listMarketers.useQuery(
    {
      page: pagination.pageIndex + 1,
      pageSize: pagination.pageSize,
      search: globalFilter.trim() || undefined,
      sortBy,
      sortDir,
      isEnabled,
    },
    {
      placeholderData: (previous) => previous,
      retry: false,
    }
  );

  const items = data?.items ?? [];
  const totalCount = data?.totalCount ?? 0;
  const pageCount = Math.max(1, Math.ceil(totalCount / pagination.pageSize));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-semibold tracking-tight">Marketers</h1>
          <p className="text-muted-foreground text-sm">
            Designate Users as Marketers and manage fee-share terms.
          </p>
        </div>
        <Link
          href="/ops/marketers/new"
          className="text-sm underline-offset-4 hover:underline"
        >
          Designate Marketer
        </Link>
      </div>

      {error ? (
        <p className="text-destructive text-sm">{error.message}</p>
      ) : null}

      <DataTable
        columns={columns}
        data={items}
        getRowId={(row) => row.id}
        isLoading={isLoading}
        isRefreshing={isFetching}
        manualPagination
        manualSorting
        manualFiltering
        pageCount={pageCount}
        rowCount={totalCount}
        enableUrlState
        urlStatePrefix="marketers"
        initialSorting={[{ id: "createdAt", desc: true }]}
        onRowClick={(row) => router.push(`/ops/marketers/${row.id}`)}
        toolbar={(table) => (
          <div className="flex w-full flex-col gap-2 sm:flex-row sm:items-center">
            <DataTableSearch
              table={table}
              placeholder="Search nickname, user, wallet, or code…"
              className="w-full sm:max-w-sm"
            />
            <label className="text-muted-foreground flex items-center gap-2 text-sm">
              Status
              <select
                value={enabledFilter}
                onChange={(event) =>
                  setEnabledFilter(
                    event.target.value as (typeof ENABLED_FILTERS)[number]
                  )
                }
                className="border-border bg-background h-8 rounded-md border px-2 text-foreground"
              >
                <option value="all">All</option>
                <option value="enabled">Enabled</option>
                <option value="disabled">Disabled</option>
              </select>
            </label>
          </div>
        )}
        pagination={(table) => <DataTablePagination table={table} />}
      />
    </div>
  );
}
