"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";
import type { inferRouterOutputs } from "@trpc/server";
import { IconRefresh } from "@tabler/icons-react";
import { parseAsStringEnum, useQueryState } from "nuqs";
import { toast } from "sonner";
import {
  DataTable,
  DataTableColumnHeader,
  DataTablePagination,
  DataTableSearch,
  useDataTableParams,
} from "@/components/data-table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { OPS_WALLET_BALANCE_REFRESH_SELECTION_CAP } from "@/lib/config/ops.config";
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
      id: "select",
      header: ({ table }) => (
        <div
          className="flex items-center justify-center"
          onClick={(event) => event.stopPropagation()}
        >
          <Checkbox
            checked={
              table.getIsAllPageRowsSelected() ||
              (table.getIsSomePageRowsSelected() && "indeterminate")
            }
            onCheckedChange={(value) =>
              table.toggleAllPageRowsSelected(!!value)
            }
            aria-label="Select all"
          />
        </div>
      ),
      cell: ({ row }) => (
        <div
          className="flex items-center justify-center"
          onClick={(event) => event.stopPropagation()}
        >
          <Checkbox
            checked={row.getIsSelected()}
            onCheckedChange={(value) => row.toggleSelected(!!value)}
            aria-label="Select row"
          />
        </div>
      ),
      enableSorting: false,
      enableHiding: false,
    },
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
  const utils = trpc.useUtils();
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

  const [rowSelection, setRowSelection] = useState<Record<string, boolean>>({});

  const sortId = sorting[0]?.id;
  const sortBy =
    sortId && SORTABLE.has(sortId)
      ? (sortId as "createdAt" | "type" | "balanceSol")
      : "createdAt";
  const sortDir: "asc" | "desc" = sorting[0]
    ? sorting[0].desc
      ? "desc"
      : "asc"
    : "desc";

  const isSystemWallet =
    systemFilter === "system"
      ? true
      : systemFilter === "non_system"
        ? false
        : undefined;

  const listInput = {
    page: pagination.pageIndex + 1,
    pageSize: pagination.pageSize,
    search: globalFilter.trim() || undefined,
    sortBy,
    sortDir,
    type: typeFilter ?? undefined,
    isSystemWallet,
    userId,
  };

  const matchFilter = {
    search: globalFilter.trim() || undefined,
    type: typeFilter ?? undefined,
    isSystemWallet,
    userId,
  };

  const { data, isLoading, isFetching, error } = trpc.ops.listWallets.useQuery(
    listInput,
    {
      placeholderData: (previous) => previous,
      retry: false,
    }
  );

  const refreshSelectedMutation = trpc.ops.refreshWalletBalances.useMutation({
    onSuccess: async (result) => {
      await utils.ops.listWallets.invalidate();
      toast.success(
        result.refreshedCount === 1
          ? "Wallet balance refreshed"
          : `${result.refreshedCount} Wallet balances refreshed`
      );
    },
    onError: (refreshError) => {
      toast.error(refreshError.message || "Failed to refresh selected Wallets");
    },
  });

  const refreshMatchesMutation =
    trpc.ops.refreshMatchingWalletBalances.useMutation({
      onSuccess: async (result) => {
        await utils.ops.listWallets.invalidate();
        toast.success(
          result.refreshedCount === 1
            ? "Wallet balance refreshed"
            : `${result.refreshedCount} Wallet balances refreshed`
        );
      },
      onError: (refreshError) => {
        toast.error(
          refreshError.message || "Failed to refresh matching Wallets"
        );
      },
    });

  const items = data?.items ?? [];
  const totalCount = data?.totalCount ?? 0;
  const pageCount = Math.max(1, Math.ceil(totalCount / pagination.pageSize));
  const columns = buildColumns(Boolean(userId));

  const selectedPublicKeys = Object.entries(rowSelection)
    .filter(([, selected]) => selected)
    .map(([publicKey]) => publicKey);

  const isRefreshing =
    refreshSelectedMutation.isPending || refreshMatchesMutation.isPending;

  const handleRefreshSelected = () => {
    if (selectedPublicKeys.length === 0) return;
    if (selectedPublicKeys.length > OPS_WALLET_BALANCE_REFRESH_SELECTION_CAP) {
      toast.error(
        `Select at most ${OPS_WALLET_BALANCE_REFRESH_SELECTION_CAP} Wallets`
      );
      return;
    }
    refreshSelectedMutation.mutate({ publicKeys: selectedPublicKeys });
  };

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
        enableRowSelection
        onRowSelectionChange={setRowSelection}
        initialSorting={[{ id: "createdAt", desc: true }]}
        onRowClick={(row) =>
          router.push(`/ops/wallets/${encodeURIComponent(row.publicKey)}`)
        }
        toolbar={(table) => (
          <div className="flex w-full flex-col gap-2">
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
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-muted-foreground text-sm">
                {selectedPublicKeys.length} selected
                {totalCount > 0 ? ` · ${totalCount} match` : null}
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={
                  selectedPublicKeys.length === 0 ||
                  isRefreshing ||
                  selectedPublicKeys.length >
                    OPS_WALLET_BALANCE_REFRESH_SELECTION_CAP
                }
                onClick={handleRefreshSelected}
              >
                {refreshSelectedMutation.isPending ? (
                  <Spinner className="size-4" />
                ) : (
                  <IconRefresh className="size-4" />
                )}
                Refresh selected
              </Button>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={totalCount === 0 || isRefreshing}
                  >
                    {refreshMatchesMutation.isPending ? (
                      <Spinner className="size-4" />
                    ) : (
                      <IconRefresh className="size-4" />
                    )}
                    Refresh matches
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Refresh matching Wallets?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This will refresh stored SOL balances for{" "}
                      <span className="font-medium text-foreground">
                        {totalCount}
                      </span>{" "}
                      Wallet{totalCount === 1 ? "" : "s"} in the current
                      search/filter result
                      {!matchFilter.search &&
                      !matchFilter.type &&
                      matchFilter.isSystemWallet === undefined &&
                      !matchFilter.userId
                        ? " (all Wallets)"
                        : ""}
                      . This may take a while and uses RPC.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      disabled={refreshMatchesMutation.isPending}
                      onClick={() =>
                        refreshMatchesMutation.mutate(matchFilter)
                      }
                    >
                      Refresh {totalCount} Wallet
                      {totalCount === 1 ? "" : "s"}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </div>
        )}
        pagination={(table) => <DataTablePagination table={table} />}
      />
    </div>
  );
}
