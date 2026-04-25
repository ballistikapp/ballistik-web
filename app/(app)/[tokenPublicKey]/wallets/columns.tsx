"use client";

import { type ColumnDef } from "@tanstack/react-table";
import { IconCopy, IconDotsVertical } from "@tabler/icons-react";
import Link from "next/link";
import { formatDistanceToNowStrict } from "date-fns";
import { type WalletItem } from "@/server/services/wallet.service";
import { type WalletType } from "@/lib/generated/prisma/enums";
import { copyToClipboard } from "@/lib/utils";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
import "@/components/data-table/types";

const walletTypeLabels: Record<WalletType, string> = {
  MAIN_WALLET: "Main",
  DEV: "Dev",
  BUNDLER: "Bundler",
  VOLUME: "Volume",
  BUYER: "Buyer",
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
  BUYER: "outline",
  DISTRIBUTION: "outline",
};

function truncatePublicKey(key: string) {
  if (key.length <= 12) return key;
  return `${key.slice(0, 6)}...${key.slice(-4)}`;
}

function formatRelativeTime(dateValue?: Date | string | null) {
  if (!dateValue) return "Never";
  const date = typeof dateValue === "string" ? new Date(dateValue) : dateValue;
  if (Number.isNaN(date.getTime())) return "Never";
  return `${formatDistanceToNowStrict(date)} ago`;
}

type WalletColumnHandlers = {
  tokenPublicKey: string;
  onRefresh: (walletPublicKey: string) => void;
  onSend: (walletPublicKey: string) => void;
  onReturn: (walletPublicKey: string) => void;
};

export function getColumns({
  tokenPublicKey,
  onRefresh,
  onSend,
  onReturn,
}: WalletColumnHandlers): ColumnDef<WalletItem>[] {
  return [
    {
      id: "select",
      header: ({ table }) => (
        <div className="flex items-center justify-center">
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
        <div className="flex items-center justify-center">
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
        <DataTableColumnHeader column={column} title="Public Key" />
      ),
      cell: ({ row }) => (
        <div className="flex items-center gap-1">
          <Link
            href={`/${tokenPublicKey}/wallets/${row.original.publicKey}`}
            className="text-sm font-mono hover:underline"
          >
            {truncatePublicKey(row.original.publicKey)}
          </Link>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="text-muted-foreground hover:text-foreground size-6"
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  void copyToClipboard(row.original.publicKey, "Wallet public key");
                }}
              >
                <IconCopy className="size-3.5" />
                <span className="sr-only">Copy wallet public key</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent>Copy public key</TooltipContent>
          </Tooltip>
        </div>
      ),
      enableHiding: false,
      meta: {
        searchable: true,
      },
    },
    {
      accessorKey: "type",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="Type" />
      ),
      cell: ({ row }) => (
        <Badge variant={walletTypeVariants[row.original.type]}>
          {walletTypeLabels[row.original.type]}
        </Badge>
      ),
      filterFn: "textArray",
      meta: {
        filter: { filterType: "text" },
        searchable: true,
      },
    },
    {
      accessorKey: "balanceSol",
      header: ({ column }) => (
        <DataTableColumnHeader
          column={column}
          title="SOL"
          className="justify-end"
        />
      ),
      cell: ({ row }) => (
        <div className="text-right font-mono">
          {Number(row.original.balanceSol).toFixed(4)} SOL
        </div>
      ),
      filterFn: "numberRange",
      meta: {
        filter: { filterType: "number" },
      },
    },
    {
      accessorKey: "balanceRefreshedAt",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="Last Refresh" />
      ),
      cell: ({ row }) => (
        <div className="text-muted-foreground text-sm">
          {formatRelativeTime(row.original.balanceRefreshedAt)}
        </div>
      ),
      meta: {
        filter: { filterType: "date" },
      },
    },
    {
      accessorKey: "createdAt",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="Created" />
      ),
      cell: ({ row }) => (
        <div className="text-muted-foreground text-sm">
          {new Date(row.original.createdAt).toLocaleDateString()}
        </div>
      ),
      filterFn: "dateRange",
      meta: {
        filter: { filterType: "date" },
      },
    },
    {
      id: "actions",
      cell: ({ row }) => {
        const wallet = row.original;

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
              <DropdownMenuItem asChild>
                <Link href={`/${tokenPublicKey}/wallets/${wallet.publicKey}`}>
                  View wallet
                </Link>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => navigator.clipboard.writeText(wallet.publicKey)}
              >
                Copy address
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <a
                  href={`https://solscan.io/account/${wallet.publicKey}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  View on Solscan
                </a>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => onRefresh(wallet.publicKey)}>
                Refresh balance
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onSend(wallet.publicKey)}>
                Send SOL
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onReturn(wallet.publicKey)}>
                Return SOL
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        );
      },
    },
  ];
}
