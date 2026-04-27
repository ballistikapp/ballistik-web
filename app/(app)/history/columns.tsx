"use client";

import { format, formatDistanceToNowStrict } from "date-fns";
import Image from "next/image";
import Link from "next/link";
import { type ColumnDef } from "@tanstack/react-table";
import type { AppTransaction } from "@/lib/generated/prisma/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { IconDotsVertical, IconExternalLink } from "@tabler/icons-react";

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
  TOKEN_DISTRIBUTE: "Distribute",
  TOKEN_CONSOLIDATE: "Consolidate",
  ACCOUNT_ATA_CREATE: "ATA Create",
  ACCOUNT_ATA_CLOSE: "ATA Close",
  REWARD_CLAIM: "Claim Rewards",
  REWARD_PAYOUT: "Reward Payout",
};

/** Soft chromatic tints — not the semantic `muted` token. */
const typeBadgeClass: Record<string, string> = {
  TRADE_BUY:
    "border-transparent bg-emerald-500/10 text-emerald-800/90 hover:bg-emerald-500/10 dark:text-emerald-400/85",
  TRADE_SELL:
    "border-transparent bg-rose-500/10 text-rose-800/90 hover:bg-rose-500/10 dark:text-rose-400/85",
  TRADE_CREATE:
    "border-transparent bg-sky-500/10 text-sky-800/90 hover:bg-sky-500/10 dark:text-sky-400/85",
  TRANSFER_FUND:
    "border-transparent bg-amber-500/10 text-amber-900/90 hover:bg-amber-500/10 dark:text-amber-400/80",
  TRANSFER_RETURN:
    "border-transparent bg-amber-500/10 text-amber-900/90 hover:bg-amber-500/10 dark:text-amber-400/80",
  TRANSFER_RECLAIM:
    "border-transparent bg-amber-500/10 text-amber-900/90 hover:bg-amber-500/10 dark:text-amber-400/80",
  TRANSFER_WITHDRAW:
    "border-transparent bg-amber-500/10 text-amber-900/90 hover:bg-amber-500/10 dark:text-amber-400/80",
  FEE_USAGE:
    "border-transparent bg-violet-500/10 text-violet-800/90 hover:bg-violet-500/10 dark:text-violet-400/85",
  FEE_SUBSCRIPTION:
    "border-transparent bg-violet-500/10 text-violet-800/90 hover:bg-violet-500/10 dark:text-violet-400/85",
  TOKEN_DISTRIBUTE:
    "border-transparent bg-teal-500/10 text-teal-800/90 hover:bg-teal-500/10 dark:text-teal-400/85",
  TOKEN_CONSOLIDATE:
    "border-transparent bg-teal-500/10 text-teal-800/90 hover:bg-teal-500/10 dark:text-teal-400/85",
  ACCOUNT_ATA_CREATE:
    "border-transparent bg-zinc-500/10 text-zinc-700/90 hover:bg-zinc-500/10 dark:text-zinc-400/90",
  ACCOUNT_ATA_CLOSE:
    "border-transparent bg-zinc-500/10 text-zinc-700/90 hover:bg-zinc-500/10 dark:text-zinc-400/90",
  REWARD_CLAIM:
    "border-transparent bg-fuchsia-500/10 text-fuchsia-800/90 hover:bg-fuchsia-500/10 dark:text-fuchsia-400/85",
  REWARD_PAYOUT:
    "border-transparent bg-fuchsia-500/10 text-fuchsia-800/90 hover:bg-fuchsia-500/10 dark:text-fuchsia-400/85",
};

function typeBadgeClassFor(type: string): string {
  return (
    typeBadgeClass[type] ??
    "border-transparent bg-zinc-500/10 text-zinc-700/90 hover:bg-zinc-500/10 dark:text-zinc-400/90"
  );
}

const sourceLabels: Record<string, string> = {
  LAUNCH: "Launch",
  EXIT: "Exit",
  VOLUME_BOT: "Volume Bot",
  HOLDING: "Holding",
  WALLET: "Wallet",
  BILLING: "Billing",
  CREATOR_REWARD: "Creator Rewards",
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

function formatRelativeTime(dateValue?: Date | string | null) {
  if (!dateValue) return "—";
  const date = typeof dateValue === "string" ? new Date(dateValue) : dateValue;
  if (Number.isNaN(date.getTime())) return "—";
  return `${formatDistanceToNowStrict(date)} ago`;
}

function formatExactTime(dateValue?: Date | string | null) {
  if (!dateValue) return "—";
  const date = typeof dateValue === "string" ? new Date(dateValue) : dateValue;
  if (Number.isNaN(date.getTime())) return "—";
  return format(date, "MMM d, h:mm:ss a");
}

export function getColumns(): ColumnDef<AppTransaction>[] {
  return [
    {
      accessorKey: "type",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="Type" />
      ),
      cell: ({ row }) => {
        const type = row.original.type;
        return (
          <Badge variant="secondary" className={typeBadgeClassFor(type)}>
            {typeLabels[type] ?? type}
          </Badge>
        );
      },
      enableHiding: false,
    },
    {
      accessorKey: "source",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="Source" />
      ),
      cell: ({ row }) => (
        <span className="text-sm">
          {sourceLabels[row.original.source] ?? row.original.source}
        </span>
      ),
    },
    {
      accessorKey: "status",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="Status" />
      ),
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
      accessorKey: "description",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="Description" />
      ),
      cell: ({ row }) => (
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="block max-w-[240px] truncate text-sm">
              {row.original.description ?? "—"}
            </span>
          </TooltipTrigger>
          <TooltipContent side="top" className="max-w-xs">
            {row.original.description ?? "—"}
          </TooltipContent>
        </Tooltip>
      ),
      enableHiding: false,
    },
    {
      accessorKey: "walletPublicKey",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="Wallet" />
      ),
      cell: ({ row }) => {
        const wallet = row.original.walletPublicKey;
        const token = row.original.tokenPublicKey;
        if (!wallet) return <span className="text-muted-foreground">—</span>;
        if (!token) {
          return <span className="font-mono text-sm">{truncateAddress(wallet)}</span>;
        }
        return (
          <Link
            href={`/${token}/wallets/${wallet}`}
            className="font-mono text-sm hover:underline"
          >
            {truncateAddress(wallet)}
          </Link>
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
      cell: ({ row }) => {
        const amount = row.original.solAmount;
        if (amount == null)
          return (
            <div className="text-right text-muted-foreground">—</div>
          );
        return (
          <div className="text-right font-mono text-sm">
            {Number(amount).toFixed(4)}
          </div>
        );
      },
    },
    {
      accessorKey: "tokenAmount",
      header: ({ column }) => (
        <DataTableColumnHeader
          column={column}
          title="Tokens"
          className="justify-end"
        />
      ),
      cell: ({ row }) => {
        const amount = row.original.tokenAmount;
        if (amount == null)
          return (
            <div className="text-right text-muted-foreground">—</div>
          );
        const num = Number(amount);
        const formatted =
          num >= 1_000_000
            ? `${(num / 1_000_000).toFixed(2)}M`
            : num >= 1_000
              ? `${(num / 1_000).toFixed(1)}K`
              : num.toFixed(2);
        return (
          <div
            className="text-right font-mono text-sm"
            title={num.toLocaleString("en-US", { maximumFractionDigits: 6 })}
          >
            {formatted}
          </div>
        );
      },
    },
    {
      accessorKey: "transactionSignature",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="Signature" />
      ),
      cell: ({ row }) => {
        const sig = row.original.transactionSignature;
        if (!sig) return <span className="text-muted-foreground">—</span>;
        return (
          <div className="flex items-center gap-1">
            <span className="font-mono text-sm text-muted-foreground">
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
      accessorKey: "fromAddress",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="From" />
      ),
      cell: ({ row }) => {
        const addr = row.original.fromAddress;
        if (!addr) return <span className="text-muted-foreground">—</span>;
        return <span className="font-mono text-sm">{truncateAddress(addr)}</span>;
      },
    },
    {
      accessorKey: "toAddress",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="To" />
      ),
      cell: ({ row }) => {
        const addr = row.original.toAddress;
        if (!addr) return <span className="text-muted-foreground">—</span>;
        return <span className="font-mono text-sm">{truncateAddress(addr)}</span>;
      },
    },
    {
      accessorKey: "bundleId",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="Bundle ID" />
      ),
      cell: ({ row }) => {
        const id = row.original.bundleId;
        if (!id) return <span className="text-muted-foreground">—</span>;
        return (
          <div className="flex items-center gap-1">
            <span className="font-mono text-sm">{truncateAddress(id)}</span>
            <Tooltip>
              <TooltipTrigger asChild>
                <a
                  href={`https://explorer.jito.wtf/bundle/${id}`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex size-6 items-center justify-center text-muted-foreground hover:text-foreground"
                >
                  <IconExternalLink className="size-3.5" />
                </a>
              </TooltipTrigger>
              <TooltipContent>View on Jito Explorer</TooltipContent>
            </Tooltip>
          </div>
        );
      },
    },
    {
      accessorKey: "errorMessage",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="Error" />
      ),
      cell: ({ row }) => {
        const msg = row.original.errorMessage;
        if (!msg) return <span className="text-muted-foreground">—</span>;
        return (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="block max-w-[200px] truncate text-sm text-red-400">
                {msg}
              </span>
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-sm">
              {msg}
            </TooltipContent>
          </Tooltip>
        );
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
      cell: ({ row }) => {
        const time = row.original.createdAt;
        return (
          <div className="text-right">
            <div className="text-sm">{formatExactTime(time)}</div>
            <div className="text-xs text-muted-foreground">
              {formatRelativeTime(time)}
            </div>
          </div>
        );
      },
    },
    {
      id: "actions",
      cell: ({ row }) => {
        const sig = row.original.transactionSignature;
        const wallet = row.original.walletPublicKey;

        return (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                className="data-[state=open]:bg-muted text-muted-foreground flex size-8"
                size="icon"
              >
                <IconDotsVertical />
                <span className="sr-only">Open menu</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              {sig && (
                <DropdownMenuItem
                  onClick={() => navigator.clipboard.writeText(sig)}
                >
                  Copy signature
                </DropdownMenuItem>
              )}
              {wallet && (
                <DropdownMenuItem
                  onClick={() => navigator.clipboard.writeText(wallet)}
                >
                  Copy wallet
                </DropdownMenuItem>
              )}
              {sig && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem asChild>
                    <a
                      href={`https://solscan.io/tx/${sig}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      View on Solscan
                    </a>
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        );
      },
    },
  ];
}
