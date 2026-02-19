"use client";

import { format, formatDistanceToNowStrict } from "date-fns";
import Link from "next/link";
import Image from "next/image";
import { type ColumnDef } from "@tanstack/react-table";
import { type UserTokensOutput } from "@/server/services/token.service";
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
  IconCopy,
  IconDotsVertical,
  IconExternalLink,
  IconBrandX,
  IconBrandTelegram,
  IconWorld,
} from "@tabler/icons-react";
import { GalleryVerticalEnd } from "lucide-react";

type TokenItem = UserTokensOutput[number];

function truncateAddress(address: string) {
  if (address.length <= 12) return address;
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

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
  return format(date, "MMM d, yyyy");
}

export const columns: ColumnDef<TokenItem>[] = [
  {
    id: "token",
    accessorFn: (row) => `${row.name} ${row.symbol}`,
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Token" />
    ),
    cell: ({ row }) => {
      const token = row.original;
      return (
        <Link
          href={`/${token.publicKey}/dashboard`}
          className="flex items-center gap-3 group"
        >
          <div className="flex aspect-square size-9 items-center justify-center rounded-lg overflow-hidden shrink-0 bg-muted">
            {token.imageUrl ? (
              <Image
                src={token.imageUrl}
                alt={token.name}
                className="h-full w-full object-cover"
                width={36}
                height={36}
                loading="lazy"
              />
            ) : (
              <GalleryVerticalEnd className="size-4 text-muted-foreground" />
            )}
          </div>
          <div className="flex flex-col gap-0.5 leading-none min-w-0">
            <span className="font-medium truncate group-hover:underline">
              {token.name}
            </span>
            <Badge variant="secondary" className="text-xs font-mono w-fit">
              ${token.symbol}
            </Badge>
          </div>
        </Link>
      );
    },
    enableHiding: false,
    meta: {
      searchable: true,
    },
  },
  {
    id: "publicKey",
    accessorKey: "publicKey",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Address" />
    ),
    cell: ({ row }) => {
      const publicKey = row.original.publicKey;
      return (
        <div className="flex items-center gap-1.5">
          <span className="text-sm font-mono text-muted-foreground">
            {truncateAddress(publicKey)}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-6 text-muted-foreground hover:text-foreground"
            onClick={(e) => {
              e.stopPropagation();
              navigator.clipboard.writeText(publicKey);
            }}
          >
            <IconCopy className="size-3.5" />
            <span className="sr-only">Copy address</span>
          </Button>
        </div>
      );
    },
    meta: {
      searchable: true,
    },
  },
  {
    id: "links",
    header: "Links",
    cell: ({ row }) => {
      const { websiteUrl, twitterUrl, telegramUrl } = row.original;
      const hasLinks = websiteUrl || twitterUrl || telegramUrl;
      if (!hasLinks) {
        return <span className="text-muted-foreground text-sm">—</span>;
      }
      return (
        <div className="flex items-center gap-1">
          {websiteUrl && (
            <Button
              asChild
              variant="ghost"
              size="icon"
              className="size-7 text-muted-foreground hover:text-foreground"
            >
              <a
                href={websiteUrl}
                target="_blank"
                rel="noreferrer"
                onClick={(e) => e.stopPropagation()}
              >
                <IconWorld className="size-4" />
              </a>
            </Button>
          )}
          {twitterUrl && (
            <Button
              asChild
              variant="ghost"
              size="icon"
              className="size-7 text-muted-foreground hover:text-foreground"
            >
              <a
                href={twitterUrl}
                target="_blank"
                rel="noreferrer"
                onClick={(e) => e.stopPropagation()}
              >
                <IconBrandX className="size-4" />
              </a>
            </Button>
          )}
          {telegramUrl && (
            <Button
              asChild
              variant="ghost"
              size="icon"
              className="size-7 text-muted-foreground hover:text-foreground"
            >
              <a
                href={telegramUrl}
                target="_blank"
                rel="noreferrer"
                onClick={(e) => e.stopPropagation()}
              >
                <IconBrandTelegram className="size-4" />
              </a>
            </Button>
          )}
        </div>
      );
    },
    enableSorting: false,
  },
  {
    accessorKey: "createdAt",
    header: ({ column }) => (
      <DataTableColumnHeader
        column={column}
        title="Created"
        className="justify-end"
      />
    ),
    cell: ({ row }) => {
      const createdAt = row.original.createdAt;
      return (
        <div className="text-right">
          <div className="text-sm">{formatExactTime(createdAt)}</div>
          <div className="text-muted-foreground text-xs">
            {formatRelativeTime(createdAt)}
          </div>
        </div>
      );
    },
  },
  {
    id: "actions",
    cell: ({ row }) => {
      const token = row.original;
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
            <DropdownMenuItem asChild>
              <Link href={`/${token.publicKey}/dashboard`}>
                <IconExternalLink className="size-4" />
                Go to Dashboard
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => navigator.clipboard.writeText(token.publicKey)}
            >
              <IconCopy className="size-4" />
              Copy Address
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <a
                href={`https://solscan.io/token/${token.publicKey}`}
                target="_blank"
                rel="noreferrer"
              >
                <IconExternalLink className="size-4" />
                View on Solscan
              </a>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <a
                href={`https://pump.fun/coin/${token.publicKey}`}
                target="_blank"
                rel="noreferrer"
              >
                <IconExternalLink className="size-4" />
                View on Pump.fun
              </a>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      );
    },
  },
];
