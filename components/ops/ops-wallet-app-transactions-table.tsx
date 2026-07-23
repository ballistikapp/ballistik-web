"use client";

import { useState } from "react";
import Image from "next/image";
import type { ColumnDef, PaginationState } from "@tanstack/react-table";
import type { inferRouterOutputs } from "@trpc/server";
import {
  DataTable,
  DataTableColumnHeader,
  DataTablePagination,
} from "@/components/data-table";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { trpc } from "@/lib/trpc/client";
import type { AppRouter } from "@/server/trpc/routers/_app";

type OpsWalletAppTransactionRow =
  inferRouterOutputs<AppRouter>["ops"]["listWalletAppTransactions"]["items"][number];

type OpsWalletAppTransactionsTableProps = {
  walletPublicKey: string;
};

const typeLabels: Record<string, string> = {
  TRADE_BUY: "Buy",
  TRADE_SELL: "Sell",
  TRADE_CREATE: "Create",
  TRANSFER_FUND: "Fund",
  TRANSFER_RETURN: "Return",
  TRANSFER_RECLAIM: "Reclaim",
  TRANSFER_WITHDRAW: "Withdraw",
  FEE_USAGE: "Platform Fee",
  FEE_SUBSCRIPTION: "Subscription Fee",
  JITO_TIP: "Jito Tip",
  TOKEN_DISTRIBUTE: "Distribute",
  TOKEN_CONSOLIDATE: "Consolidate",
  ACCOUNT_ATA_CREATE: "ATA Create",
  ACCOUNT_ATA_CLOSE: "ATA Close",
  REWARD_CLAIM: "Claim Rewards",
  REWARD_PAYOUT: "Reward Payout",
};

const statusConfig: Record<string, { label: string; dotClass: string }> = {
  CONFIRMED: { label: "Confirmed", dotClass: "bg-green-500" },
  PENDING: { label: "Pending", dotClass: "bg-amber-500" },
  FAILED: { label: "Failed", dotClass: "bg-red-500" },
};

function truncateAddress(address: string) {
  if (address.length <= 12) return address;
  return `${address.slice(0, 4)}...${address.slice(-4)}`;
}

function formatDate(value: Date | string | null | undefined) {
  if (!value) return "—";
  return new Date(value).toLocaleString();
}

const columns: ColumnDef<OpsWalletAppTransactionRow>[] = [
  {
    accessorKey: "createdAt",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="time" />
    ),
    enableSorting: false,
    cell: ({ row }) => (
      <span className="text-sm whitespace-nowrap">
        {formatDate(row.original.createdAt)}
      </span>
    ),
  },
  {
    accessorKey: "type",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="type" />
    ),
    enableSorting: false,
    cell: ({ row }) => (
      <span className="text-sm">
        {typeLabels[row.original.type] ?? row.original.type}
      </span>
    ),
  },
  {
    accessorKey: "status",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="status" />
    ),
    enableSorting: false,
    cell: ({ row }) => {
      const cfg = statusConfig[row.original.status];
      return (
        <div className="flex items-center gap-1.5">
          <span
            className={`inline-block size-2 rounded-full ${cfg?.dotClass ?? "bg-muted"}`}
          />
          <span className="text-sm">{cfg?.label ?? row.original.status}</span>
        </div>
      );
    },
  },
  {
    accessorKey: "solAmount",
    header: ({ column }) => (
      <DataTableColumnHeader
        column={column}
        title="SOL"
        className="justify-end"
      />
    ),
    enableSorting: false,
    cell: ({ row }) => {
      const amount = row.original.solAmount;
      if (amount == null) {
        return <div className="text-right text-muted-foreground">—</div>;
      }
      return (
        <div className="text-right font-mono text-sm">
          {amount.toFixed(4)}
        </div>
      );
    },
  },
  {
    accessorKey: "transactionSignature",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="signature" />
    ),
    enableSorting: false,
    cell: ({ row }) => {
      const sig = row.original.transactionSignature;
      if (!sig) return <span className="text-muted-foreground">—</span>;
      return (
        <div className="flex items-center gap-1">
          <span className="font-mono text-xs text-muted-foreground">
            {truncateAddress(sig)}
          </span>
          <Tooltip>
            <TooltipTrigger asChild>
              <a
                href={`https://solscan.io/tx/${sig}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex size-6 items-center justify-center text-muted-foreground hover:text-foreground"
              >
                <Image
                  src="/logos/solscan-logo-dark.svg"
                  alt="Solscan"
                  width={14}
                  height={14}
                  className="size-3.5"
                />
              </a>
            </TooltipTrigger>
            <TooltipContent>View on Solscan</TooltipContent>
          </Tooltip>
        </div>
      );
    },
  },
  {
    accessorKey: "description",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="description" />
    ),
    enableSorting: false,
    cell: ({ row }) => (
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="block max-w-[280px] truncate text-sm">
            {row.original.description ?? "—"}
          </span>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-xs">
          {row.original.description ?? "—"}
        </TooltipContent>
      </Tooltip>
    ),
  },
];

export function OpsWalletAppTransactionsTable({
  walletPublicKey,
}: OpsWalletAppTransactionsTableProps) {
  const [pagination, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: 25,
  });

  const { data, isLoading, isFetching, error } =
    trpc.ops.listWalletAppTransactions.useQuery(
      {
        walletPublicKey,
        page: pagination.pageIndex + 1,
        pageSize: pagination.pageSize,
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
    <div className="flex flex-col gap-3">
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
        pageCount={pageCount}
        rowCount={totalCount}
        initialPagination={pagination}
        onPaginationStateChange={(next) => {
          setPagination((prev) =>
            prev.pageIndex === next.pageIndex && prev.pageSize === next.pageSize
              ? prev
              : next
          );
        }}
        pagination={(table) => <DataTablePagination table={table} />}
      />
    </div>
  );
}
