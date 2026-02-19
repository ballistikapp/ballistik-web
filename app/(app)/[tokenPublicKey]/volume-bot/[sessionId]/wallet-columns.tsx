"use client";

import { formatDistanceToNowStrict } from "date-fns";
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

export type SessionWalletRow = {
  id: string;
  walletPublicKey: string;
  walletType: string;
  status: string;
  solBalance: number;
  tradesExecuted: number;
  pnlSol: number;
  lastTradeAt: Date | null;
};

function truncateKey(key: string) {
  if (key.length <= 12) return key;
  return `${key.slice(0, 6)}...${key.slice(-4)}`;
}

const walletTypeLabels: Record<string, string> = {
  VOLUME: "Volume",
  DEV: "Dev",
  BUNDLER: "Bundler",
  MAIN_WALLET: "Main",
  DISTRIBUTION: "Distribution",
};

const walletTypeBadgeClass: Record<string, string> = {
  VOLUME: "border-sky-500/30 bg-sky-500/10 text-sky-400",
  DEV: "border-purple-500/30 bg-purple-500/10 text-purple-400",
  BUNDLER: "border-indigo-500/30 bg-indigo-500/10 text-indigo-400",
  MAIN_WALLET: "border-amber-500/30 bg-amber-500/10 text-amber-400",
  DISTRIBUTION: "border-cyan-500/30 bg-cyan-500/10 text-cyan-400",
};

const statusBadgeClass: Record<string, string> = {
  ACTIVE: "border-emerald-500/30 bg-emerald-500/10 text-emerald-400",
  PAUSED: "border-amber-500/30 bg-amber-500/10 text-amber-400",
  RECLAIMED: "border-zinc-500/30 bg-zinc-500/10 text-zinc-300",
  FAILED: "border-red-500/30 bg-red-500/10 text-red-400",
};

export function getWalletColumns(
  tokenPublicKey: string
): ColumnDef<SessionWalletRow>[] {
  return [
    {
      accessorKey: "walletPublicKey",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="Wallet" />
      ),
      cell: ({ row }) => {
        const pk = row.original.walletPublicKey;
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
      enableHiding: false,
    },
    {
      accessorKey: "walletType",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="Type" />
      ),
      cell: ({ row }) => {
        const type = row.original.walletType;
        return (
          <Badge
            variant="outline"
            className={`${walletTypeBadgeClass[type] ?? "text-foreground"} font-semibold tracking-wide`}
          >
            {walletTypeLabels[type] ?? type}
          </Badge>
        );
      },
      filterFn: "textArray",
      meta: {
        filter: { filterType: "text" },
      },
    },
    {
      accessorKey: "status",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="Status" />
      ),
      cell: ({ row }) => {
        const status = row.original.status;
        return (
          <Badge
            variant="outline"
            className={`${statusBadgeClass[status] ?? "text-foreground"} font-semibold tracking-wide`}
          >
            {status}
          </Badge>
        );
      },
      filterFn: "textArray",
      meta: {
        filter: { filterType: "text" },
      },
    },
    {
      accessorKey: "solBalance",
      header: ({ column }) => (
        <div className="flex w-full justify-end">
          <DataTableColumnHeader column={column} title="Balance" />
        </div>
      ),
      cell: ({ row }) => (
        <div className="text-right font-mono text-sm">
          {row.original.solBalance.toFixed(4)} SOL
        </div>
      ),
    },
    {
      accessorKey: "pnlSol",
      header: ({ column }) => (
        <div className="flex w-full justify-end">
          <DataTableColumnHeader column={column} title="PnL" />
        </div>
      ),
      cell: ({ row }) => {
        const pnl = row.original.pnlSol;
        const colorClass =
          pnl > 0 ? "text-green-400" : pnl < 0 ? "text-red-400" : "";
        return (
          <div className={`text-right font-mono text-sm ${colorClass}`}>
            {pnl >= 0 ? "+" : ""}
            {pnl.toFixed(4)}
          </div>
        );
      },
    },
    {
      accessorKey: "tradesExecuted",
      header: ({ column }) => (
        <div className="flex w-full justify-end">
          <DataTableColumnHeader column={column} title="Trades" />
        </div>
      ),
      cell: ({ row }) => (
        <div className="text-right text-sm tabular-nums">
          {row.original.tradesExecuted}
        </div>
      ),
    },
    {
      accessorKey: "lastTradeAt",
      header: ({ column }) => (
        <DataTableColumnHeader
          column={column}
          title="Last Trade"
          className="justify-end"
        />
      ),
      cell: ({ row }) => {
        const lastTrade = row.original.lastTradeAt;
        if (!lastTrade) {
          return (
            <div className="text-right text-sm text-muted-foreground">—</div>
          );
        }
        return (
          <div className="text-right text-sm text-muted-foreground">
            {formatDistanceToNowStrict(lastTrade)} ago
          </div>
        );
      },
    },
  ];
}
