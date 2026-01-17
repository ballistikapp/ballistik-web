"use client";

import { type ColumnDef } from "@tanstack/react-table";
import { IconDotsVertical } from "@tabler/icons-react";
import { type WalletItem } from "@/server/services/wallet.service";
import { type WalletType } from "@/lib/generated/prisma/enums";

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
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
import "@/components/data-table/types";

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

function truncatePublicKey(key: string) {
  if (key.length <= 12) return key;
  return `${key.slice(0, 6)}...${key.slice(-4)}`;
}

export const columns: ColumnDef<WalletItem>[] = [
  {
    id: "select",
    header: ({ table }) => (
      <div className="flex items-center justify-center">
        <Checkbox
          checked={
            table.getIsAllPageRowsSelected() ||
            (table.getIsSomePageRowsSelected() && "indeterminate")
          }
          onCheckedChange={(value) => table.toggleAllPageRowsSelected(!!value)}
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
      <code className="text-sm font-mono">
        {truncatePublicKey(row.original.publicKey)}
      </code>
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
        title="Balance"
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
          <DropdownMenuContent align="end" className="w-40">
            <DropdownMenuItem
              onClick={() => navigator.clipboard.writeText(wallet.publicKey)}
            >
              Copy address
            </DropdownMenuItem>
            <DropdownMenuItem>View on Solscan</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive">Remove</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      );
    },
  },
];
