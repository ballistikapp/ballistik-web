"use client";

import { useRouter } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";
import type { inferRouterOutputs } from "@trpc/server";
import { parseAsStringEnum, useQueryState } from "nuqs";
import {
  DataTable,
  DataTableColumnHeader,
  DataTablePagination,
  DataTableSearch,
  useDataTableParams,
} from "@/components/data-table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { trpc } from "@/lib/trpc/client";
import type { AppRouter } from "@/server/trpc/routers/_app";

type OpsWalletRow =
  inferRouterOutputs<AppRouter>["ops"]["listWallets"]["items"][number];

type OpsWalletsTableProps = {
  userId?: string;
  embedded?: boolean;
};

const WALLET_TYPES = [
  "MAIN_WALLET",
  "DEV",
  "BUNDLER",
  "VOLUME",
  "BUYER",
  "DISTRIBUTION",
] as const;

type WalletTypeFilter = (typeof WALLET_TYPES)[number];

const SYSTEM_FILTERS = ["all", "system", "non_system"] as const;
type SystemFilter = (typeof SYSTEM_FILTERS)[number];

function formatDate(value: Date | string | null | undefined) {
  if (!value) return "—";
  return new Date(value).toLocaleString();
}

function buildColumns(hideUserColumn: boolean): ColumnDef<OpsWalletRow>[] {
  const columns: ColumnDef<OpsWalletRow>[] = [
    {
      accessorKey: "publicKey",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="pubkey" />
      ),
      enableSorting: false,
      cell: ({ row }) => (
        <span className="font-mono text-xs break-all">
          {row.original.publicKey}
        </span>
      ),
    },
    {
      accessorKey: "type",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="type" />
      ),
      cell: ({ row }) => row.original.type,
    },
    {
      accessorKey: "isSystemWallet",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="system" />
      ),
      enableSorting: false,
      cell: ({ row }) => (row.original.isSystemWallet ? "yes" : "no"),
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
      cell: ({ row }) =>
        row.original.userId ? (
          <div className="flex flex-col gap-0.5">
            <span>{row.original.userName ?? "—"}</span>
            <span className="text-muted-foreground font-mono text-xs break-all">
              {row.original.userId}
            </span>
          </div>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    });
  }

  columns.push(
    {
      accessorKey: "tokenPublicKey",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="token" />
      ),
      enableSorting: false,
      cell: ({ row }) =>
        row.original.tokenPublicKey ? (
          <span className="font-mono text-xs break-all">
            {row.original.tokenPublicKey}
          </span>
        ) : (
          "—"
        ),
    },
    {
      accessorKey: "balanceSol",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="SOL" />
      ),
      cell: ({ row }) => row.original.balanceSol.toFixed(4),
    },
    {
      accessorKey: "balanceRefreshedAt",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="refreshed" />
      ),
      enableSorting: false,
      cell: ({ row }) => formatDate(row.original.balanceRefreshedAt),
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

const SORTABLE = new Set(["createdAt", "type", "balanceSol"]);

export function OpsWalletsTable({
  userId,
  embedded = false,
}: OpsWalletsTableProps) {
  const router = useRouter();
  const urlPrefix = userId ? "spine_wallets" : "wallets";
  const typeParam = userId ? "spine_wallets_type" : "wallets_type";
  const systemParam = userId ? "spine_wallets_system" : "wallets_system";

  const { pagination, sorting, globalFilter, setPagination } =
    useDataTableParams({
      defaultPageSize: 25,
      defaultSort: "createdAt:desc",
      prefix: urlPrefix,
    });

  const [typeFilter, setTypeFilter] = useQueryState(
    typeParam,
    parseAsStringEnum([...WALLET_TYPES]).withOptions({
      history: "replace",
      shallow: true,
    })
  );

  const [systemFilter, setSystemFilter] = useQueryState(
    systemParam,
    parseAsStringEnum([...SYSTEM_FILTERS])
      .withDefault("all")
      .withOptions({ history: "replace", shallow: true })
  );

  const sortId = sorting[0]?.id;
  const sortBy =
    sortId && SORTABLE.has(sortId)
      ? (sortId as "createdAt" | "type" | "balanceSol")
      : "createdAt";
  const sortDir = sorting[0] ? (sorting[0].desc ? "desc" : "asc") : "desc";

  const isSystemWallet =
    systemFilter === "system"
      ? true
      : systemFilter === "non_system"
        ? false
        : undefined;

  const { data, isLoading, isFetching, error } = trpc.ops.listWallets.useQuery(
    {
      page: pagination.pageIndex + 1,
      pageSize: pagination.pageSize,
      search: globalFilter.trim() || undefined,
      sortBy,
      sortDir,
      type: typeFilter ?? undefined,
      isSystemWallet,
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
          <h1 className="text-xl font-semibold tracking-tight">Wallets</h1>
          <p className="text-muted-foreground text-sm">
            Browse all Wallets including system. Open a row for Wallet detail.
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
          router.push(`/ops/wallets/${encodeURIComponent(row.publicKey)}`)
        }
        toolbar={(table) => (
          <div className="flex w-full flex-col gap-2 sm:flex-row sm:items-center">
            <DataTableSearch
              table={table}
              placeholder="Search pubkey, user, token, or type…"
              className="w-full sm:max-w-sm"
            />
            <Select
              value={typeFilter ?? "all"}
              onValueChange={(value) => {
                setPagination((prev) => ({ ...prev, pageIndex: 0 }));
                if (value === "all") {
                  void setTypeFilter(null);
                  return;
                }
                void setTypeFilter(value as WalletTypeFilter);
              }}
            >
              <SelectTrigger className="w-full sm:w-[180px]" size="sm">
                <SelectValue placeholder="Type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All types</SelectItem>
                {WALLET_TYPES.map((type) => (
                  <SelectItem key={type} value={type}>
                    {type}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {userId ? null : (
              <Select
                value={systemFilter}
                onValueChange={(value) => {
                  setPagination((prev) => ({ ...prev, pageIndex: 0 }));
                  void setSystemFilter(value as SystemFilter);
                }}
              >
                <SelectTrigger className="w-full sm:w-[180px]" size="sm">
                  <SelectValue placeholder="System" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All wallets</SelectItem>
                  <SelectItem value="system">System only</SelectItem>
                  <SelectItem value="non_system">Non-system</SelectItem>
                </SelectContent>
              </Select>
            )}
          </div>
        )}
        pagination={(table) => <DataTablePagination table={table} />}
      />
    </div>
  );
}
