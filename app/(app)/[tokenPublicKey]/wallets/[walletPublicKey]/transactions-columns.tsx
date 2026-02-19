"use client";

import { format, formatDistanceToNowStrict } from "date-fns";
import { type ColumnDef } from "@tanstack/react-table";
import { type TransactionItem } from "@/server/services/transaction.service";
import { Badge } from "@/components/ui/badge";
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";

const typeLabels: Record<string, string> = {
  BUY: "Buy",
  SELL: "Sell",
  CREATE: "Create",
};

const actionClassByType: Record<string, string> = {
  BUY: "border-green-500/30 bg-green-500/10 text-green-400",
  SELL: "border-red-500/30 bg-red-500/10 text-red-400",
  CREATE: "border-blue-500/30 bg-blue-500/10 text-blue-400",
};

const statusLabels: Record<string, string> = {
  CONFIRMED: "Confirmed",
  PENDING: "Pending",
  FAILED: "Failed",
};

function formatRelativeTime(dateValue?: Date | string | null) {
  if (!dateValue) return "Never";
  const date = typeof dateValue === "string" ? new Date(dateValue) : dateValue;
  if (Number.isNaN(date.getTime())) return "Never";
  return `${formatDistanceToNowStrict(date)} ago`;
}

function formatExactTime(dateValue?: Date | string | null) {
  if (!dateValue) return "Never";
  const date = typeof dateValue === "string" ? new Date(dateValue) : dateValue;
  if (Number.isNaN(date.getTime())) return "Never";
  return format(date, "MMM d, h:mm:ss a");
}

function formatReadableTokenAmount(value: number) {
  if (!Number.isFinite(value)) return "0";
  if (Math.abs(value) < 1_000) return value.toFixed(2);
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 2,
  }).format(value);
}

type ColumnOptions = {
  tokenSymbol: string;
};

export function getTransactionsColumns({
  tokenSymbol,
}: ColumnOptions): ColumnDef<TransactionItem>[] {
  return [
    {
      accessorKey: "transactionType",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="Action" />
      ),
      cell: ({ row }) => {
        const actionType = row.original.transactionType;
        return (
          <Badge
            variant="outline"
            className={actionClassByType[actionType] ?? "text-foreground"}
          >
            {typeLabels[actionType]}
          </Badge>
        );
      },
      filterFn: "textArray",
      meta: {
        filter: { filterType: "text" },
        searchable: true,
      },
    },
    {
      accessorKey: "status",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="Status" />
      ),
      cell: ({ row }) => (
        <Badge variant="secondary">{statusLabels[row.original.status]}</Badge>
      ),
      filterFn: "textArray",
      meta: {
        filter: { filterType: "text" },
        searchable: true,
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
      cell: ({ row }) => {
        const actionType = row.original.transactionType;
        const amountClass =
          actionType === "BUY"
            ? "text-green-400"
            : actionType === "SELL"
              ? "text-red-400"
              : "text-blue-400";
        return (
          <div className={`text-right font-mono ${amountClass}`}>
            {Number(row.original.solAmount).toFixed(4)}
          </div>
        );
      },
      filterFn: "numberRange",
      meta: {
        filter: { filterType: "number" },
      },
    },
    {
      accessorKey: "tokenAmount",
      header: ({ column }) => (
        <DataTableColumnHeader
          column={column}
          title={tokenSymbol}
          className="justify-end"
        />
      ),
      cell: ({ row }) => {
        const actionType = row.original.transactionType;
        const amountClass =
          actionType === "BUY"
            ? "text-green-400"
            : actionType === "SELL"
              ? "text-red-400"
              : "text-blue-400";
        return (
          <div
            className={`text-right font-mono ${amountClass}`}
            title={Number(row.original.tokenAmount).toLocaleString("en-US", {
              maximumFractionDigits: 6,
            })}
          >
            {formatReadableTokenAmount(Number(row.original.tokenAmount))}
          </div>
        );
      },
      filterFn: "numberRange",
      meta: {
        filter: { filterType: "number" },
      },
    },
    {
      accessorKey: "transactionSignature",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="Signature" />
      ),
      cell: ({ row }) => (
        <div className="font-mono text-xs text-muted-foreground">
          {row.original.transactionSignature.slice(0, 8)}...
          {row.original.transactionSignature.slice(-6)}
        </div>
      ),
      meta: {
        searchable: true,
      },
    },
    {
      accessorKey: "blockTime",
      header: ({ column }) => (
        <DataTableColumnHeader
          column={column}
          title="Time"
          className="justify-end"
        />
      ),
      cell: ({ row }) => {
        const timeValue = row.original.blockTime ?? row.original.createdAt;
        return (
          <div className="text-right">
            <div className="text-sm">{formatExactTime(timeValue)}</div>
            <div className="text-xs text-muted-foreground">
              {formatRelativeTime(timeValue)}
            </div>
          </div>
        );
      },
      meta: {
        filter: { filterType: "date" },
      },
    },
  ];
}
