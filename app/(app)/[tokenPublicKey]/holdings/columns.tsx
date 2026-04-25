"use client";

import Link from "next/link";
import { formatDistanceToNowStrict } from "date-fns";
import { type ColumnDef } from "@tanstack/react-table";
import { type HoldingItem } from "@/server/services/holding.service";
import { type WalletType } from "@/lib/generated/prisma/enums";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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

function truncateSignature(signature: string) {
  if (signature.length <= 12) return signature;
  return `${signature.slice(0, 6)}...${signature.slice(-4)}`;
}

function formatRelativeTime(dateValue?: Date | string | null) {
  if (!dateValue) return "Never";
  const date = typeof dateValue === "string" ? new Date(dateValue) : dateValue;
  if (Number.isNaN(date.getTime())) return "Never";
  return `${formatDistanceToNowStrict(date)} ago`;
}

type ColumnOptions = {
  tokenPublicKey: string;
  tokenSymbol: string;
  tokenSupply?: number | null;
};

export function getColumns({
  tokenPublicKey,
  tokenSymbol,
  tokenSupply,
}: ColumnOptions): ColumnDef<HoldingItem>[] {
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
      id: "walletPublicKey",
      accessorKey: "wallet.publicKey",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="Wallet" />
      ),
      cell: ({ row }) => (
        <Link
          href={`/${tokenPublicKey}/wallets/${row.original.wallet.publicKey}`}
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
        return (
          <div className="text-right font-mono">{percentage.toFixed(4)}%</div>
        );
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
        <div className="text-muted-foreground text-sm">
          {formatRelativeTime(row.original.lastUpdated)}
        </div>
      ),
      meta: {
        filter: { filterType: "date" },
      },
    },
    {
      id: "actions",
      cell: ({ row }) => {
        const holding = row.original;
        const signature = holding.lastTransactionSignature;

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
                onClick={() =>
                  navigator.clipboard.writeText(holding.wallet.publicKey)
                }
              >
                Copy wallet
              </DropdownMenuItem>
              {signature && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={() => navigator.clipboard.writeText(signature)}
                  >
                    Copy signature
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <a
                      href={`https://solscan.io/tx/${signature}`}
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
