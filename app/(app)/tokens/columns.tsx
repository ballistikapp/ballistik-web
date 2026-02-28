"use client";

import { format, formatDistanceToNowStrict } from "date-fns";
import Link from "next/link";
import Image from "next/image";
import { type ColumnDef } from "@tanstack/react-table";
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
  IconRecycle,
} from "@tabler/icons-react";
import { GalleryVerticalEnd } from "lucide-react";

export type TokenRowStatus = "PENDING" | "ACTIVE" | "FAILED";

export type TokenTableRow = {
  id: string;
  name: string;
  symbol: string;
  status: TokenRowStatus;
  publicKey: string | null;
  imageUrl?: string | null;
  websiteUrl?: string | null;
  twitterUrl?: string | null;
  telegramUrl?: string | null;
  createdAt: Date | string;
  launchId: string;
  errorMessage?: string | null;
};

type TokenColumnsOptions = {
  onReclaim?: (row: TokenTableRow) => void;
};

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

function statusBadgeClass(status: TokenRowStatus) {
  switch (status) {
    case "ACTIVE":
      return "bg-emerald-500/10 text-emerald-700 border-emerald-500/20";
    case "PENDING":
      return "bg-amber-500/10 text-amber-700 border-amber-500/20";
    case "FAILED":
      return "bg-red-500/10 text-red-700 border-red-500/20";
    default:
      return "";
  }
}

export const createColumns = (
  options: TokenColumnsOptions = {}
): ColumnDef<TokenTableRow>[] => [
  {
    id: "token",
    accessorFn: (row) => `${row.name} ${row.symbol}`,
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Token" />
    ),
    cell: ({ row }) => {
      const item = row.original;
      const hasLink = Boolean(item.publicKey);
      const content = (
        <div className="flex items-center gap-3 group">
          <div className="flex aspect-square size-9 items-center justify-center rounded-lg overflow-hidden shrink-0 bg-muted">
            {item.imageUrl ? (
              <Image
                src={item.imageUrl}
                alt={item.name}
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
              {item.name}
            </span>
            <Badge variant="secondary" className="text-xs font-mono w-fit">
              ${item.symbol}
            </Badge>
          </div>
        </div>
      );
      if (hasLink) {
        return (
          <Link href={`/${item.publicKey}/dashboard`}>{content}</Link>
        );
      }
      return content;
    },
    enableHiding: false,
    meta: {
      searchable: true,
    },
  },
  {
    id: "publicKey",
    accessorFn: (row) => row.publicKey ?? row.launchId ?? "",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Address" />
    ),
    cell: ({ row }) => {
      const item = row.original;
      if (!item.publicKey) {
        return (
          <span className="text-sm text-muted-foreground">—</span>
        );
      }
      return (
        <div className="flex items-center gap-1.5">
          <span className="text-sm font-mono text-muted-foreground">
            {truncateAddress(item.publicKey)}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-6 text-muted-foreground hover:text-foreground"
            onClick={(e) => {
              e.stopPropagation();
              navigator.clipboard.writeText(item.publicKey!);
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
    id: "status",
    accessorKey: "status",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Status" />
    ),
    cell: ({ row }) => {
      const status = row.original.status;
      return (
        <Badge variant="outline" className={statusBadgeClass(status)}>
          {status}
        </Badge>
      );
    },
    filterFn: "textArray",
    meta: {
      filter: { filterType: "text" as const },
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
      const item = row.original;
      const isFailed = item.status === "FAILED";
      const hasPublicKey = Boolean(item.publicKey);
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
            {hasPublicKey && (
              <DropdownMenuItem asChild>
                <Link href={`/${item.publicKey}/dashboard`}>
                  <IconExternalLink className="size-4" />
                  Go to Dashboard
                </Link>
              </DropdownMenuItem>
            )}
            {hasPublicKey && (
              <DropdownMenuItem
                onClick={() =>
                  navigator.clipboard.writeText(item.publicKey!)
                }
              >
                <IconCopy className="size-4" />
                Copy Address
              </DropdownMenuItem>
            )}
            {isFailed && options.onReclaim && (
              <DropdownMenuItem
                onClick={() => options.onReclaim?.(item)}
              >
                <IconRecycle className="size-4" />
                Reclaim SOL
              </DropdownMenuItem>
            )}
            {hasPublicKey && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <a
                    href={`https://solscan.io/token/${item.publicKey}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <IconExternalLink className="size-4" />
                    View on Solscan
                  </a>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <a
                    href={`https://pump.fun/coin/${item.publicKey}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <IconExternalLink className="size-4" />
                    View on Pump.fun
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
