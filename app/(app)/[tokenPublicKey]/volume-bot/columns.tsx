"use client";

import { formatDistanceToNowStrict } from "date-fns";
import Link from "next/link";
import { type ColumnDef } from "@tanstack/react-table";
import { type VolumeBotSessionItem } from "@/server/services/volume-bot.service";
import type { VolumeBotConfigInput } from "@/server/schemas/volume-bot.schema";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";

const statusVariants: Record<
  string,
  "default" | "secondary" | "outline" | "destructive"
> = {
  SCHEDULED: "secondary",
  RUNNING: "default",
  STOP_REQUESTED: "secondary",
  STOPPING: "secondary",
  STOPPED: "outline",
  FAILED: "destructive",
  DRAFT: "outline",
};

const statusLabels: Record<string, string> = {
  SCHEDULED: "Scheduled",
  RUNNING: "Running",
  STOP_REQUESTED: "Stop requested",
  STOPPING: "Stopping",
  STOPPED: "Stopped",
  FAILED: "Failed",
  DRAFT: "Draft",
};

function formatRelativeTime(dateValue?: Date | string | null) {
  if (!dateValue) return "Never";
  const date = typeof dateValue === "string" ? new Date(dateValue) : dateValue;
  if (Number.isNaN(date.getTime())) return "Never";
  return `${formatDistanceToNowStrict(date)} ago`;
}

function formatRuntime(seconds?: number | null) {
  if (seconds === null || seconds === undefined) return "—";
  const safeSeconds = Math.max(0, seconds);
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const secs = safeSeconds % 60;
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  if (minutes > 0) {
    return `${minutes}m ${secs}s`;
  }
  return `${secs}s`;
}

const resolveNetDirection = (config?: VolumeBotConfigInput) => {
  const ranges = config?.ranges ?? [];
  const netSolDirection = ranges.reduce((sum, range) => {
    const avgAmount = (range.solMin + range.solMax) / 2;
    if (range.direction === "buy") {
      return sum + range.probability * avgAmount;
    }
    if (range.direction === "sell") {
      return sum - range.probability * avgAmount;
    }
    const buyProbability = range.buyProbability ?? 0;
    return sum + range.probability * avgAmount * (2 * buyProbability - 1);
  }, 0);
  if (netSolDirection > 0) return "net buy";
  if (netSolDirection < 0) return "net sell";
  return "neutral";
};

type ColumnOptions = {
  tokenPublicKey?: string | null;
};

export function getColumns({
  tokenPublicKey,
}: ColumnOptions): ColumnDef<VolumeBotSessionItem>[] {
  return [
    {
      accessorKey: "status",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="Status" />
      ),
      cell: ({ row }) => {
        const value = row.original.status ?? "DRAFT";
        return (
          <Badge variant={statusVariants[value] ?? "outline"}>
            {statusLabels[value] ?? value}
          </Badge>
        );
      },
      filterFn: "textArray",
      meta: {
        filter: { filterType: "text" },
        searchable: true,
      },
    },
    {
      id: "startedAt",
      accessorFn: (row) => row.startedAt ?? row.createdAt,
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="Started" />
      ),
      cell: ({ row }) =>
        formatRelativeTime(row.original.startedAt ?? row.original.createdAt),
      meta: {
        filter: { filterType: "date" },
      },
    },
    {
      accessorKey: "totalTrades",
      header: ({ column }) => (
        <DataTableColumnHeader
          column={column}
          title="Trades"
          className="justify-end"
        />
      ),
      cell: ({ row }) => (
        <div className="text-right font-mono">{row.original.totalTrades}</div>
      ),
      filterFn: "numberRange",
      meta: {
        filter: { filterType: "number" },
      },
    },
    {
      accessorKey: "totalVolumeUsd",
      header: ({ column }) => (
        <DataTableColumnHeader
          column={column}
          title="Volume (USD)"
          className="justify-end"
        />
      ),
      cell: ({ row }) => (
        <div className="text-right font-mono">
          {Number(row.original.totalVolumeUsd).toFixed(2)}
        </div>
      ),
      filterFn: "numberRange",
      meta: {
        filter: { filterType: "number" },
      },
    },
    {
      id: "ranges",
      header: ({ column }) => (
        <DataTableColumnHeader
          column={column}
          title="Ranges"
          className="justify-end"
        />
      ),
      cell: ({ row }) => {
        const config = row.original.config as VolumeBotConfigInput;
        const rangeCount = config?.ranges?.length ?? 0;
        const netDirection = resolveNetDirection(config);
        return (
          <div className="text-right font-mono">
            {rangeCount} · {netDirection}
          </div>
        );
      },
    },
    {
      accessorKey: "totalPnlSol",
      header: ({ column }) => (
        <DataTableColumnHeader
          column={column}
          title="Net SOL"
          className="justify-end"
        />
      ),
      cell: ({ row }) => (
        <div className="text-right font-mono">
          {Number(row.original.totalPnlSol).toFixed(3)}
        </div>
      ),
      filterFn: "numberRange",
      meta: {
        filter: { filterType: "number" },
      },
    },
    {
      accessorKey: "runtimeSeconds",
      header: ({ column }) => (
        <DataTableColumnHeader
          column={column}
          title="Runtime"
          className="justify-end"
        />
      ),
      cell: ({ row }) => (
        <div className="text-right font-mono">
          {formatRuntime(row.original.runtimeSeconds)}
        </div>
      ),
    },
    {
      id: "actions",
      header: () => null,
      cell: ({ row }) => {
        const runToken = tokenPublicKey ?? row.original.tokenPublicKey;
        const href = runToken
          ? `/${runToken}/volume-bot/${row.original.id}`
          : `/volume-bot/${row.original.id}`;
        return (
          <div className="flex justify-end">
            <Button asChild variant="outline" size="sm">
              <Link href={href}>View run</Link>
            </Button>
          </div>
        );
      },
    },
  ];
}
