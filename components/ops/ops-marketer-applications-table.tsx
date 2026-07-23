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
  useDataTableParams,
} from "@/components/data-table";
import { trpc } from "@/lib/trpc/client";
import type { AppRouter } from "@/server/trpc/routers/_app";

type OpsMarketerApplicationRow =
  inferRouterOutputs<AppRouter>["ops"]["listMarketerApplications"]["items"][number];

const STATUS_FILTERS = ["PENDING", "APPROVED", "REJECTED", "all"] as const;

function formatDate(value: Date | string | null | undefined) {
  if (!value) return "—";
  return new Date(value).toLocaleString();
}

const columns: ColumnDef<OpsMarketerApplicationRow>[] = [
  {
    accessorKey: "status",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="status" />
    ),
    enableSorting: false,
    cell: ({ row }) => row.original.status,
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
    accessorKey: "message",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="message" />
    ),
    enableSorting: false,
    cell: ({ row }) => {
      const message = row.original.message;
      return message.length > 80 ? `${message.slice(0, 80)}…` : message;
    },
  },
  {
    accessorKey: "createdAt",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="submitted" />
    ),
    cell: ({ row }) => formatDate(row.original.createdAt),
  },
];

export function OpsMarketerApplicationsTable() {
  const router = useRouter();
  const { pagination, sorting } = useDataTableParams({
    defaultPageSize: 25,
    defaultSort: "createdAt:desc",
    prefix: "applications",
  });

  const [statusFilter, setStatusFilter] = useQueryState(
    "applications_status",
    parseAsStringEnum([...STATUS_FILTERS])
      .withDefault("PENDING")
      .withOptions({ history: "replace", shallow: true })
  );

  const sortDir = sorting[0] ? (sorting[0].desc ? "desc" : "asc") : "desc";
  const status =
    statusFilter === "all"
      ? undefined
      : (statusFilter as "PENDING" | "APPROVED" | "REJECTED");

  const { data, isLoading, isFetching, error } =
    trpc.ops.listMarketerApplications.useQuery(
      {
        page: pagination.pageIndex + 1,
        pageSize: pagination.pageSize,
        status,
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
      <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-semibold tracking-tight">
            Marketer Applications
          </h1>
          <p className="text-muted-foreground text-sm">
            Review intake requests. Designate via Create Marketer to approve.
          </p>
        </div>
        <Link
          href="/ops/marketers"
          className="text-sm underline-offset-4 hover:underline"
        >
          Back to Marketers
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
        urlStatePrefix="applications"
        initialSorting={[{ id: "createdAt", desc: true }]}
        onRowClick={(row) =>
          router.push(`/ops/marketers/applications/${row.id}`)
        }
        toolbar={() => (
          <label className="text-muted-foreground flex items-center gap-2 text-sm">
            Status
            <select
              value={statusFilter}
              onChange={(event) =>
                setStatusFilter(
                  event.target.value as (typeof STATUS_FILTERS)[number]
                )
              }
              className="border-border bg-background h-8 rounded-md border px-2 text-foreground"
            >
              <option value="PENDING">Pending</option>
              <option value="APPROVED">Approved</option>
              <option value="REJECTED">Rejected</option>
              <option value="all">All</option>
            </select>
          </label>
        )}
        pagination={(table) => <DataTablePagination table={table} />}
      />
    </div>
  );
}
