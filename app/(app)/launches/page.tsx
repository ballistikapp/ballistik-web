"use client";

import Link from "next/link";
import * as React from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc/client";
import {
  DataTable,
  DataTablePagination,
  DataTableSearch,
  DataTableViewOptions,
} from "@/components/data-table";
import { PageHeader } from "@/components/layout/sections";
import { Button } from "@/components/ui/button";
import { createLaunchHistoryColumns } from "./columns";
import {
  mapUserLaunchToHistoryRow,
  type LaunchHistoryRow,
} from "./launch-history-rows";
import { TokenReclaimDialog } from "@/components/launch/token-reclaim-dialog";

export default function LaunchHistoryPage() {
  const router = useRouter();
  const { data: launches, isLoading } = trpc.launch.getUserLaunches.useQuery(
    undefined,
    {
      refetchOnMount: "always",
    }
  );
  const retryLaunchMutation = trpc.launch.retry.useMutation({
    onSuccess: () => {
      toast.message("Retry started", {
        description: "A new launch attempt has been queued.",
      });
      router.push("/launch");
    },
    onError: (error) => {
      toast.error("Failed to retry launch", {
        description: error.message || "Unable to start retry launch.",
      });
    },
  });

  const [reclaimTarget, setReclaimTarget] = React.useState<{
    tokenPublicKey?: string;
    launchId?: string;
  } | null>(null);

  const tableRows: LaunchHistoryRow[] = React.useMemo(() => {
    if (!launches) return [];
    return launches.map(mapUserLaunchToHistoryRow);
  }, [launches]);

  const columns = React.useMemo(
    () =>
      createLaunchHistoryColumns({
        onReclaim: (row) => {
          if (row.publicKey) {
            setReclaimTarget({ tokenPublicKey: row.publicKey });
          } else {
            setReclaimTarget({ launchId: row.launchId });
          }
        },
        onRetry: (row) => {
          retryLaunchMutation.mutate({ launchId: row.launchId });
        },
      }),
    [retryLaunchMutation]
  );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Launch history"
        rightContent={
          <Button asChild>
            <Link href="/launch">
              <Plus className="size-4" />
              Launch New Token
            </Link>
          </Button>
        }
      />

      <DataTable
        columns={columns}
        data={tableRows}
        isLoading={isLoading}
        getRowId={(row) => row.id}
        searchableColumns={["name", "symbol", "publicKey"]}
        toolbar={(table) => (
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <DataTableSearch
              table={table}
              placeholder="Search launch history..."
              className="w-full sm:max-w-sm"
            />
            <DataTableViewOptions table={table} />
          </div>
        )}
        pagination={(table) => <DataTablePagination table={table} />}
      />
      <TokenReclaimDialog
        open={Boolean(reclaimTarget)}
        onOpenChange={(open) => {
          if (!open) {
            setReclaimTarget(null);
          }
        }}
        tokenPublicKey={reclaimTarget?.tokenPublicKey ?? null}
        launchId={reclaimTarget?.launchId ?? null}
      />
    </div>
  );
}
