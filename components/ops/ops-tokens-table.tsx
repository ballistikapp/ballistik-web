"use client";

import { useRouter } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";
import type { inferRouterOutputs } from "@trpc/server";
import {
  DataTable,
  DataTableColumnHeader,
  DataTablePagination,
  DataTableSearch,
  useDataTableParams,
} from "@/components/data-table";
import { trpc } from "@/lib/trpc/client";
import type { AppRouter } from "@/server/trpc/routers/_app";

type OpsTokenRow =
  inferRouterOutputs<AppRouter>["ops"]["listTokens"]["items"][number];

type OpsTokensTableProps = {
  userId?: string;
  embedded?: boolean;
};

function formatDate(value: Date | string | null | undefined) {
  if (!value) return "—";
  return new Date(value).toLocaleString();
}

function buildColumns(hideUserColumn: boolean): ColumnDef<OpsTokenRow>[] {
  const columns: ColumnDef<OpsTokenRow>[] = [
    {
      accessorKey: "publicKey",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="mint" />
      ),
      enableSorting: false,
      cell: ({ row }) => (
        <span className="font-mono text-xs break-all">
          {row.original.publicKey}
        </span>
      ),
    },
    {
      accessorKey: "name",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="name" />
      ),
      cell: ({ row }) => row.original.name,
    },
    {
      accessorKey: "symbol",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="symbol" />
      ),
      cell: ({ row }) => row.original.symbol,
    },
    {
      accessorKey: "status",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="status" />
      ),
      cell: ({ row }) => row.original.status,
    },
  ];

  if (!hideUserColumn) {
    columns.push({
      id: "user",
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
    });
  }

  columns.push({
    accessorKey: "createdAt",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="created" />
    ),
    cell: ({ row }) => formatDate(row.original.createdAt),
  });

  return columns;
}

const SORTABLE = new Set(["createdAt", "name", "symbol", "status"]);

export function OpsTokensTable({
  userId,
  embedded = false,
}: OpsTokensTableProps) {
  const router = useRouter();
  const urlPrefix = userId ? "spine_tokens" : "tokens";
  const { pagination, sorting, globalFilter } = useDataTableParams({
    defaultPageSize: 25,
    defaultSort: "createdAt:desc",
    prefix: urlPrefix,
  });

  const sortId = sorting[0]?.id;
  const sortBy =
    sortId && SORTABLE.has(sortId)
      ? (sortId as "createdAt" | "name" | "symbol" | "status")
      : "createdAt";
  const sortDir = sorting[0] ? (sorting[0].desc ? "desc" : "asc") : "desc";

  const { data, isLoading, isFetching, error } = trpc.ops.listTokens.useQuery(
    {
      page: pagination.pageIndex + 1,
      pageSize: pagination.pageSize,
      search: globalFilter.trim() || undefined,
      sortBy,
      sortDir,
      userId,
    },
    {
      placeholderData: (previous) => previous,
      retry: false,
    }
  );

  const items = data?.items ?? [];
  const totalCount = data?.totalCount ?? 0;
  const pageCount = Math.max(1, Math.ceil(totalCount / pagination.pageSize));
  const columns = buildColumns(Boolean(userId));

  return (
    <div className="flex flex-col gap-4">
      {embedded ? null : (
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-semibold tracking-tight">Tokens</h1>
          <p className="text-muted-foreground text-sm">
            Browse Tokens. Open a row for Token detail.
          </p>
        </div>
      )}

      {error ? (
        <p className="text-destructive text-sm">{error.message}</p>
      ) : null}

      <DataTable
        columns={columns}
        data={items}
        getRowId={(row) => row.publicKey}
        isLoading={isLoading}
        isRefreshing={isFetching}
        manualPagination
        manualSorting
        manualFiltering
        pageCount={pageCount}
        rowCount={totalCount}
        enableUrlState
        urlStatePrefix={urlPrefix}
        initialSorting={[{ id: "createdAt", desc: true }]}
        onRowClick={(row) =>
          router.push(`/ops/tokens/${encodeURIComponent(row.publicKey)}`)
        }
        toolbar={(table) => (
          <DataTableSearch
            table={table}
            placeholder="Search mint, name, symbol, user, or status…"
            className="w-full sm:max-w-sm"
          />
        )}
        pagination={(table) => <DataTablePagination table={table} />}
      />
    </div>
  );
}
