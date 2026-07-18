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

type OpsLaunchRow =
  inferRouterOutputs<AppRouter>["ops"]["listLaunches"]["items"][number];

type OpsLaunchesTableProps = {
  userId?: string;
  embedded?: boolean;
};

function formatDate(value: Date | string | null | undefined) {
  if (!value) return "—";
  return new Date(value).toLocaleString();
}

function buildColumns(hideUserColumn: boolean): ColumnDef<OpsLaunchRow>[] {
  const columns: ColumnDef<OpsLaunchRow>[] = [
    {
      accessorKey: "id",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="id" />
      ),
      enableSorting: false,
      cell: ({ row }) => (
        <span className="font-mono text-xs break-all">{row.original.id}</span>
      ),
    },
    {
      accessorKey: "status",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="status" />
      ),
      cell: ({ row }) => row.original.status,
    },
    {
      accessorKey: "progress",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="progress" />
      ),
      enableSorting: false,
      cell: ({ row }) => `${row.original.progress}%`,
    },
    {
      accessorKey: "currentStep",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="step" />
      ),
      enableSorting: false,
      cell: ({ row }) => row.original.currentStep ?? "—",
    },
    {
      accessorKey: "tokenPublicKey",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="token" />
      ),
      enableSorting: false,
      cell: ({ row }) => (
        <span className="font-mono text-xs break-all">
          {row.original.tokenPublicKey ?? "—"}
        </span>
      ),
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

  columns.push(
    {
      accessorKey: "startedAt",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="started" />
      ),
      cell: ({ row }) => formatDate(row.original.startedAt),
    },
    {
      accessorKey: "createdAt",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="created" />
      ),
      cell: ({ row }) => formatDate(row.original.createdAt),
    }
  );

  return columns;
}

const SORTABLE = new Set(["createdAt", "startedAt", "status"]);

export function OpsLaunchesTable({
  userId,
  embedded = false,
}: OpsLaunchesTableProps) {
  const router = useRouter();
  const urlPrefix = userId ? "spine_launches" : "launches";
  const { pagination, sorting, globalFilter } = useDataTableParams({
    defaultPageSize: 25,
    defaultSort: "createdAt:desc",
    prefix: urlPrefix,
  });

  const sortId = sorting[0]?.id;
  const sortBy =
    sortId && SORTABLE.has(sortId)
      ? (sortId as "createdAt" | "startedAt" | "status")
      : "createdAt";
  const sortDir = sorting[0] ? (sorting[0].desc ? "desc" : "asc") : "desc";

  const { data, isLoading, isFetching, error } = trpc.ops.listLaunches.useQuery(
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
          <h1 className="text-xl font-semibold tracking-tight">Launches</h1>
          <p className="text-muted-foreground text-sm">
            Browse Launches. Open a row for the Launch autopsy.
          </p>
        </div>
      )}

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
        urlStatePrefix={urlPrefix}
        initialSorting={[{ id: "createdAt", desc: true }]}
        onRowClick={(row) => router.push(`/ops/launches/${row.id}`)}
        toolbar={(table) => (
          <DataTableSearch
            table={table}
            placeholder="Search id, mint, user, status, or step…"
            className="w-full sm:max-w-sm"
          />
        )}
        pagination={(table) => <DataTablePagination table={table} />}
      />
    </div>
  );
}
