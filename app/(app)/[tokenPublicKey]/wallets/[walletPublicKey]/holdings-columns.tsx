"use client";

import { formatDistanceToNowStrict } from "date-fns";
import { type ColumnDef } from "@tanstack/react-table";
import { type HoldingItem } from "@/server/services/holding.service";
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";

function formatRelativeTime(dateValue?: Date | string | null) {
  if (!dateValue) return "Never";
  const date = typeof dateValue === "string" ? new Date(dateValue) : dateValue;
  if (Number.isNaN(date.getTime())) return "Never";
  return `${formatDistanceToNowStrict(date)} ago`;
}

type ColumnOptions = {
  tokenSymbol: string;
  tokenSupply?: number | null;
};

export function getHoldingsColumns({
  tokenSymbol,
  tokenSupply,
}: ColumnOptions): ColumnDef<HoldingItem>[] {
  return [
    {
      accessorKey: "tokenBalance",
      header: ({ column }) => (
        <DataTableColumnHeader
          column={column}
          title={`Balance (${tokenSymbol})`}
          className="justify-end"
        />
      ),
      cell: ({ row }) => (
        <div className="text-right font-mono">
          {Number(row.original.tokenBalance).toFixed(4)}
        </div>
      ),
      filterFn: "numberRange",
      meta: {
        filter: { filterType: "number" },
      },
    },
    {
      id: "holdingPercentage",
      accessorFn: (row) => {
        const balance = Number(row.tokenBalance);
        if (!Number.isFinite(balance) || !tokenSupply || tokenSupply <= 0) return -1;
        return (balance / tokenSupply) * 100;
      },
      header: ({ column }) => (
        <DataTableColumnHeader
          column={column}
          title="Holding %"
          className="justify-end"
        />
      ),
      cell: ({ row }) => {
        const balance = Number(row.original.tokenBalance);
        if (!Number.isFinite(balance) || !tokenSupply || tokenSupply <= 0) {
          return <div className="text-right font-mono">--</div>;
        }
        const percentage = (balance / tokenSupply) * 100;
        return <div className="text-right font-mono">{percentage.toFixed(4)}%</div>;
      },
      filterFn: "numberRange",
      meta: {
        filter: { filterType: "number" },
      },
    },
    {
      accessorKey: "lastUpdated",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="Last Updated" />
      ),
      cell: ({ row }) => (
        <div className="text-sm text-muted-foreground">
          {formatRelativeTime(row.original.lastUpdated)}
        </div>
      ),
      meta: {
        filter: { filterType: "date" },
      },
    },
  ];
}
