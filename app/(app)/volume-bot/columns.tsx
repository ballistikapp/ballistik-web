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
  RUNNING: "default",
  STOP_REQUESTED: "secondary",
  STOPPING: "secondary",
  STOPPED: "outline",
  FAILED: "destructive",
  DRAFT: "outline",
};

const statusLabels: Record<string, string> = {
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

const resolveTargetSol = (config?: VolumeBotConfigInput & { targetSolApplied?: number }) =>
  config?.targetSolApplied ?? config?.strategyTargetSol ?? null;

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
      id: "targetSol",
      header: ({ column }) => (
        <DataTableColumnHeader
          column={column}
          title="Target (SOL)"
          className="justify-end"
        />
      ),
      cell: ({ row }) => {
        const config = row.original.config as VolumeBotConfigInput & {
          targetSolApplied?: number;
        };
        const targetSol = resolveTargetSol(config);
        return (
          <div className="text-right font-mono">
            {targetSol !== null ? targetSol.toFixed(2) : "—"}
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
          ? `/volume-bot/${row.original.id}?token=${runToken}`
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
