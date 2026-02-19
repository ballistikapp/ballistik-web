"use client";

import { format, formatDistanceToNowStrict } from "date-fns";
import Link from "next/link";
import { type ColumnDef } from "@tanstack/react-table";
import { CopyIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DataTableColumnHeader } from "@/components/data-table";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

type LogData = {
  tradeAmountSol?: number;
  netSolChangeSol?: number;
  actualSol?: number;
  tokenAmount?: string;
  action?: string;
  rangeIndex?: number;
};

export type VolumeBotLogRow = {
  id: string;
  level: string;
  type: string;
  message: string;
  data: LogData | null;
  walletPublicKey: string | null;
  signature: string | null;
  createdAt: Date;
};

function truncateKey(key: string) {
  if (key.length <= 12) return key;
  return `${key.slice(0, 6)}...${key.slice(-4)}`;
}

function formatRelativeTime(dateValue: Date | string) {
  const date = typeof dateValue === "string" ? new Date(dateValue) : dateValue;
  if (Number.isNaN(date.getTime())) return "—";
  return `${formatDistanceToNowStrict(date)} ago`;
}

function formatExactTime(dateValue: Date | string) {
  const date = typeof dateValue === "string" ? new Date(dateValue) : dateValue;
  if (Number.isNaN(date.getTime())) return "—";
  return format(date, "HH:mm:ss");
}

const typeLabels: Record<string, string> = {
  TRADE: "Trade",
  BUY: "Buy",
  SELL: "Sell",
  SKIP: "Skip",
  ERROR: "Error",
  PAUSE: "Pause",
  RESUME: "Resume",
  START: "Start",
  STOP: "Stop",
  RECLAIM: "Reclaim",
  ELIGIBILITY: "Eligibility",
};

const typeBadgeClass: Record<string, string> = {
  BUY: "border-emerald-500/30 bg-emerald-500/10 text-emerald-400",
  SELL: "border-rose-500/30 bg-rose-500/10 text-rose-400",
  TRADE: "border-sky-500/30 bg-sky-500/10 text-sky-400",
  START: "border-indigo-500/30 bg-indigo-500/10 text-indigo-400",
  STOP: "border-slate-500/30 bg-slate-500/10 text-slate-300",
  RECLAIM: "border-purple-500/30 bg-purple-500/10 text-purple-400",
  SKIP: "border-amber-500/30 bg-amber-500/10 text-amber-400",
  PAUSE: "border-orange-500/30 bg-orange-500/10 text-orange-400",
  RESUME: "border-cyan-500/30 bg-cyan-500/10 text-cyan-400",
  ERROR: "border-red-500/30 bg-red-500/10 text-red-400",
  ELIGIBILITY: "border-zinc-500/30 bg-zinc-500/10 text-zinc-300",
};

export function getTransactionsColumns(
  tokenPublicKey: string
): ColumnDef<VolumeBotLogRow>[] {
  return [
    {
      accessorKey: "type",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="Type" />
      ),
      cell: ({ row }) => {
        const type = row.original.type.toUpperCase();
        return (
          <Badge
            variant="outline"
            className={`${typeBadgeClass[type] ?? "text-foreground"} font-semibold tracking-wide`}
          >
            {typeLabels[type] ?? type}
          </Badge>
        );
      },
      enableHiding: false,
      filterFn: "textArray",
      meta: {
        filter: { filterType: "text" },
        searchable: true,
      },
    },
    {
      accessorFn: (row) => row.walletPublicKey ?? "—",
      id: "walletPublicKey",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="Wallet" />
      ),
      cell: ({ row }) => {
        const pk = row.original.walletPublicKey;
        if (!pk) return <span className="text-muted-foreground">—</span>;
        return (
          <div className="flex items-center gap-1.5">
            <Link
              href={`/${tokenPublicKey}/wallets/${pk}`}
              className="font-mono text-sm hover:underline"
            >
              {truncateKey(pk)}
            </Link>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-6 text-muted-foreground hover:text-foreground"
                  onClick={() => {
                    void navigator.clipboard.writeText(pk);
                  }}
                >
                  <CopyIcon className="size-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Copy public key</TooltipContent>
            </Tooltip>
          </div>
        );
      },
      filterFn: "textArray",
      meta: {
        filter: { filterType: "text" },
        searchable: true,
      },
    },
    {
      accessorFn: (row) => row.data?.tradeAmountSol ?? Number.NaN,
      id: "tradeAmount",
      header: ({ column }) => (
        <div className="flex w-full justify-end">
          <DataTableColumnHeader column={column} title="Amount (SOL)" />
        </div>
      ),
      cell: ({ row }) => {
        const data = row.original.data;
        const amount = data?.tradeAmountSol;
        if (amount == null) return <div className="text-right text-muted-foreground">—</div>;
        const type = row.original.type;
        const colorClass =
          type === "BUY" ? "text-green-400" : type === "SELL" ? "text-red-400" : "";
        return (
          <div className={`text-right font-mono ${colorClass}`}>
            {amount.toFixed(4)}
          </div>
        );
      },
      filterFn: "numberRange",
      meta: {
        filter: { filterType: "number" },
      },
    },
    {
      accessorFn: (row) => row.data?.netSolChangeSol ?? Number.NaN,
      id: "netSolChange",
      header: ({ column }) => (
        <div className="flex w-full justify-end">
          <DataTableColumnHeader column={column} title="Net SOL" />
        </div>
      ),
      cell: ({ row }) => {
        const data = row.original.data;
        const net = data?.netSolChangeSol;
        if (net == null) return <div className="text-right text-muted-foreground">—</div>;
        const colorClass =
          net > 0 ? "text-green-400" : net < 0 ? "text-red-400" : "";
        return (
          <div className={`text-right font-mono ${colorClass}`}>
            {net >= 0 ? "+" : ""}
            {net.toFixed(4)}
          </div>
        );
      },
      filterFn: "numberRange",
      meta: {
        filter: { filterType: "number" },
      },
    },
    {
      accessorKey: "message",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="Message" />
      ),
      cell: ({ row }) => (
        <div className="max-w-[300px] truncate text-sm text-muted-foreground">
          {row.original.message}
        </div>
      ),
      filterFn: "textArray",
      meta: {
        filter: { filterType: "text" },
        searchable: true,
      },
    },
    {
      accessorKey: "createdAt",
      header: ({ column }) => (
        <DataTableColumnHeader
          column={column}
          title="Time"
          className="justify-end"
        />
      ),
      cell: ({ row }) => (
        <div className="text-right">
          <div className="text-sm">{formatExactTime(row.original.createdAt)}</div>
          <div className="text-muted-foreground text-xs">
            {formatRelativeTime(row.original.createdAt)}
          </div>
        </div>
      ),
      filterFn: "dateRange",
      meta: {
        filter: { filterType: "date" },
      },
    },
  ];
}
