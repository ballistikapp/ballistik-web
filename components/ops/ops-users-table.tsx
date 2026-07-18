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

type OpsUserRow =
  inferRouterOutputs<AppRouter>["ops"]["listUsers"]["items"][number];

function formatDate(value: Date | string | null | undefined) {
  if (!value) return "—";
  return new Date(value).toLocaleString();
}

const columns: ColumnDef<OpsUserRow>[] = [
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
    accessorKey: "name",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="name" />
    ),
    cell: ({ row }) => row.original.name,
  },
  {
    accessorKey: "mainWalletPublicKey",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="main wallet" />
    ),
    enableSorting: false,
    cell: ({ row }) => (
      <span className="font-mono text-xs break-all">
        {row.original.mainWalletPublicKey}
      </span>
    ),
  },
  {
    accessorKey: "plan",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="plan" />
    ),
    cell: ({ row }) => row.original.plan,
  },
  {
    accessorKey: "paidPlanExpiresAt",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="plan expires" />
    ),
    enableSorting: false,
    cell: ({ row }) => formatDate(row.original.paidPlanExpiresAt),
  },
  {
    accessorKey: "createdAt",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="created" />
    ),
    cell: ({ row }) => formatDate(row.original.createdAt),
  },
];

const SORTABLE = new Set(["createdAt", "name", "plan"]);

export function OpsUsersTable() {
  const router = useRouter();
  const { pagination, sorting, globalFilter } = useDataTableParams({
    defaultPageSize: 25,
    defaultSort: "createdAt:desc",
    prefix: "users",
  });

  const sortId = sorting[0]?.id;
  const sortBy =
    sortId && SORTABLE.has(sortId)
      ? (sortId as "createdAt" | "name" | "plan")
      : "createdAt";
  const sortDir = sorting[0] ? (sorting[0].desc ? "desc" : "asc") : "desc";

  const { data, isLoading, isFetching, error } = trpc.ops.listUsers.useQuery(
    {
      page: pagination.pageIndex + 1,
      pageSize: pagination.pageSize,
      search: globalFilter.trim() || undefined,
      sortBy,
      sortDir,
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
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold tracking-tight">Users</h1>
        <p className="text-muted-foreground text-sm">
          Browse Users. Open a row for the User spine.
        </p>
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
        urlStatePrefix="users"
        initialSorting={[{ id: "createdAt", desc: true }]}
        onRowClick={(row) => router.push(`/ops/users/${row.id}`)}
        toolbar={(table) => (
          <DataTableSearch
            table={table}
            placeholder="Search name, main wallet, or id…"
            className="w-full sm:max-w-sm"
          />
        )}
        pagination={(table) => <DataTablePagination table={table} />}
      />
    </div>
  );
}
