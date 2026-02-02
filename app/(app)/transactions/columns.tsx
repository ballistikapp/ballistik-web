"use client";

import { formatDistanceToNowStrict } from "date-fns";
import Link from "next/link";
import { type ColumnDef } from "@tanstack/react-table";
import { type TransactionItem } from "@/server/services/transaction.service";
import { type WalletType } from "@/lib/generated/prisma/enums";
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
import { IconDotsVertical } from "@tabler/icons-react";

const walletTypeLabels: Record<WalletType, string> = {
  MAIN_WALLET: "Main",
  DEV: "Dev",
  BUNDLER: "Bundler",
  VOLUME: "Volume",
  DISTRIBUTION: "Distribution",
};

const walletTypeVariants: Record<
  WalletType,
  "default" | "secondary" | "outline"
> = {
  MAIN_WALLET: "default",
  DEV: "secondary",
  BUNDLER: "outline",
  VOLUME: "outline",
  DISTRIBUTION: "outline",
};

const typeLabels: Record<string, string> = {
  BUY: "Buy",
  SELL: "Sell",
  CREATE: "Create",
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

function truncateSignature(signature: string) {
  if (signature.length <= 12) return signature;
  return `${signature.slice(0, 6)}...${signature.slice(-4)}`;
}

type ColumnOptions = {
  tokenPublicKey: string;
  tokenSymbol: string;
};

export function getColumns({
  tokenPublicKey,
  tokenSymbol,
}: ColumnOptions): ColumnDef<TransactionItem>[] {
  return [
    {
      id: "walletPublicKey",
      accessorKey: "wallet.publicKey",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="Wallet" />
      ),
      cell: ({ row }) => (
        <Link
          href={`/wallets/${row.original.wallet.publicKey}?token=${tokenPublicKey}`}
          className="text-sm font-mono hover:underline"
        >
          {truncateSignature(row.original.wallet.publicKey)}
        </Link>
      ),
      enableHiding: false,
      meta: {
        searchable: true,
      },
    },
    {
      id: "walletType",
      accessorKey: "wallet.type",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="Type" />
      ),
      cell: ({ row }) => (
        <Badge variant={walletTypeVariants[row.original.wallet.type]}>
          {walletTypeLabels[row.original.wallet.type]}
        </Badge>
      ),
      filterFn: "textArray",
      meta: {
        filter: { filterType: "text" },
        searchable: true,
      },
    },
    {
      accessorKey: "transactionType",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="Action" />
      ),
      cell: ({ row }) => (
        <Badge variant="outline">
          {typeLabels[row.original.transactionType]}
        </Badge>
      ),
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
      cell: ({ row }) => (
        <div className="text-right font-mono">
          {Number(row.original.solAmount).toFixed(4)}
        </div>
      ),
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
      cell: ({ row }) => (
        <div className="text-right font-mono">
          {Number(row.original.tokenAmount).toFixed(4)}
        </div>
      ),
      filterFn: "numberRange",
      meta: {
        filter: { filterType: "number" },
      },
    },
    {
      accessorKey: "pricePerToken",
      header: ({ column }) => (
        <DataTableColumnHeader
          column={column}
          title="Price"
          className="justify-end"
        />
      ),
      cell: ({ row }) => (
        <div className="text-right font-mono">
          {Number(row.original.pricePerToken).toFixed(6)}
        </div>
      ),
      filterFn: "numberRange",
      meta: {
        filter: { filterType: "number" },
      },
    },
    {
      accessorKey: "blockTime",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="Time" />
      ),
      cell: ({ row }) => (
        <div className="text-muted-foreground text-sm">
          {formatRelativeTime(row.original.blockTime ?? row.original.createdAt)}
        </div>
      ),
      meta: {
        filter: { filterType: "date" },
      },
    },
    {
      id: "actions",
      cell: ({ row }) => {
        const signature = row.original.transactionSignature;

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
            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuItem
                onClick={() => navigator.clipboard.writeText(signature)}
              >
                Copy signature
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild>
                <a
                  href={`https://solscan.io/tx/${signature}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  View on Solscan
                </a>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        );
      },
    },
  ];
}
