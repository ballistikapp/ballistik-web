"use client";

import * as React from "react";
import Image from "next/image";
import { format, formatDistanceToNowStrict } from "date-fns";
import type { ColumnDef } from "@tanstack/react-table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DataTable,
  DataTablePagination,
  DataTableSearch,
  DataTableColumnHeader,
} from "@/components/data-table";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc/client";
import { legacyCapabilityDeniedMessage } from "@/lib/launch/legacy-capability";
import { GalleryVerticalEnd } from "lucide-react";
import { IconCopy } from "@tabler/icons-react";

type LaunchRow = {
  id: string;
  status: string;
  tokenPublicKey: string | null;
  tokenName: string;
  tokenSymbol: string;
  imageUrl: string | null;
  createdAt: Date | string;
  isLegacy: boolean;
  input: Record<string, unknown> | null;
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

function statusBadgeClass(status: string) {
  switch (status) {
    case "SUCCEEDED":
      return "bg-emerald-500/10 text-emerald-700 border-emerald-500/20";
    case "RUNNING":
    case "PENDING":
      return "bg-amber-500/10 text-amber-700 border-amber-500/20";
    case "FAILED":
    case "CANCELED":
      return "bg-red-500/10 text-red-700 border-red-500/20";
    default:
      return "";
  }
}

function createCloneColumns(): ColumnDef<LaunchRow>[] {
  return [
    {
      id: "token",
      accessorFn: (row) => `${row.tokenName} ${row.tokenSymbol}`,
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="Token" />
      ),
      cell: ({ row }) => {
        const item = row.original;
        return (
          <div className="flex items-center gap-3">
            <div className="flex aspect-square size-9 items-center justify-center rounded-lg overflow-hidden shrink-0 bg-muted">
              {item.imageUrl ? (
                <Image
                  src={item.imageUrl}
                  alt={item.tokenName}
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
              <span className="font-medium truncate">{item.tokenName}</span>
              <Badge variant="secondary" className="text-xs font-mono w-fit">
                ${item.tokenSymbol}
              </Badge>
            </div>
          </div>
        );
      },
      enableHiding: false,
      meta: { searchable: true },
    },
    {
      id: "publicKey",
      accessorFn: (row) => row.tokenPublicKey ?? "",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="Address" />
      ),
      cell: ({ row }) => {
        const item = row.original;
        if (!item.tokenPublicKey) {
          return <span className="text-sm text-muted-foreground">&mdash;</span>;
        }
        return (
          <div className="flex items-center gap-1.5">
            <span className="text-sm font-mono text-muted-foreground">
              {truncateAddress(item.tokenPublicKey)}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-6 text-muted-foreground hover:text-foreground"
              onClick={(e) => {
                e.stopPropagation();
                navigator.clipboard.writeText(item.tokenPublicKey!);
              }}
            >
              <IconCopy className="size-3.5" />
              <span className="sr-only">Copy address</span>
            </Button>
          </div>
        );
      },
      meta: { searchable: true },
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
  ];
}

type CloneTokenDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onClone: (input: Record<string, unknown>) => void;
};

export function CloneTokenDialog({
  open,
  onOpenChange,
  onClone,
}: CloneTokenDialogProps) {
  const { data: launches, isLoading } = trpc.launch.getUserLaunches.useQuery(
    undefined,
    { enabled: open }
  );

  const [selectedId, setSelectedId] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) {
      setSelectedId(null);
    }
  }, [open]);

  const columns = React.useMemo(() => createCloneColumns(), []);

  const cloneableLaunches: LaunchRow[] = React.useMemo(
    () =>
      (launches ?? [])
        .filter((launch) => !launch.isLegacy && launch.input != null)
        .map((launch) => ({
          id: launch.id,
          status: launch.status,
          tokenPublicKey: launch.tokenPublicKey,
          tokenName: launch.tokenName,
          tokenSymbol: launch.tokenSymbol,
          imageUrl: launch.imageUrl,
          createdAt: launch.createdAt,
          isLegacy: launch.isLegacy,
          input: launch.input,
        })),
    [launches]
  );

  const selectedLaunch = React.useMemo(
    () => cloneableLaunches.find((l) => l.id === selectedId) ?? null,
    [cloneableLaunches, selectedId]
  );

  const hasOnlyLegacyLaunches =
    !isLoading &&
    cloneableLaunches.length === 0 &&
    (launches?.some((launch) => launch.isLegacy) ?? false);

  const utils = trpc.useUtils();
  const [isCloning, setIsCloning] = React.useState(false);

  const handleClone = async () => {
    if (!selectedLaunch) return;
    setIsCloning(true);
    try {
      const input = await utils.launch.getCloneInput.fetch({
        launchId: selectedLaunch.id,
      });
      onClone(input);
      onOpenChange(false);
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : legacyCapabilityDeniedMessage("clone");
      toast.error("Failed to clone launch", { description: message });
    } finally {
      setIsCloning(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-4xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Clone Token Configuration</DialogTitle>
          <DialogDescription>
            Select a previous launch to clone its configuration into the form.
          </DialogDescription>
        </DialogHeader>

        {hasOnlyLegacyLaunches && (
          <p className="text-sm text-muted-foreground">
            {legacyCapabilityDeniedMessage("clone")}
          </p>
        )}
        {!isLoading &&
          !hasOnlyLegacyLaunches &&
          cloneableLaunches.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No previous launches available to clone.
            </p>
          )}

        <DataTable
          columns={columns}
          data={cloneableLaunches}
          isLoading={isLoading}
          getRowId={(row) => row.id}
          searchableColumns={["token", "publicKey"]}
          onRowClick={(row) => setSelectedId(row.id)}
          rowClassName={(row) =>
            row.id === selectedId
              ? "bg-primary/5 border-primary/20 hover:bg-primary/5 cursor-default"
              : undefined
          }
          toolbar={(table) => (
            <DataTableSearch
              table={table}
              placeholder="Search launches..."
              className="max-w-sm"
            />
          )}
          pagination={(table) => <DataTablePagination table={table} />}
          initialPagination={{ pageIndex: 0, pageSize: 5 }}
        />

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={!selectedLaunch || isCloning}
            onClick={() => void handleClone()}
          >
            {isCloning ? "Cloning..." : "Clone"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
