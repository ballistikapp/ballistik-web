"use client";

import Link from "next/link";
import * as React from "react";
import { Plus } from "lucide-react";
import { trpc } from "@/lib/trpc/client";
import {
  DataTable,
  DataTablePagination,
  DataTableSearch,
  DataTableViewOptions,
} from "@/components/data-table";
import { PageHeader } from "@/components/layout/sections";
import { Button } from "@/components/ui/button";
import {
  createColumns,
  type TokenTableRow,
  type TokenRowStatus,
} from "./columns";
import { TokenReclaimDialog } from "./token-reclaim-dialog";

const LAUNCH_STATUS_MAP: Record<string, TokenRowStatus> = {
  SUCCEEDED: "ACTIVE",
  RUNNING: "PENDING",
  PENDING: "PENDING",
  FAILED: "FAILED",
  CANCELED: "FAILED",
};

export default function ManageTokensPage() {
  const { data: launches, isLoading } = trpc.launch.getUserLaunches.useQuery();

  const [reclaimTarget, setReclaimTarget] = React.useState<{
    tokenPublicKey?: string;
    launchId?: string;
  } | null>(null);

  const tableRows: TokenTableRow[] = React.useMemo(() => {
    if (!launches) return [];
    return launches.map((launch) => ({
      id: launch.id,
      name: launch.tokenName,
      symbol: launch.tokenSymbol,
      status: LAUNCH_STATUS_MAP[launch.status] ?? "PENDING",
      publicKey: launch.tokenPublicKey,
      imageUrl: launch.imageUrl,
      websiteUrl: launch.websiteUrl,
      twitterUrl: launch.twitterUrl,
      telegramUrl: launch.telegramUrl,
      createdAt: launch.createdAt,
      launchId: launch.id,
      errorMessage: launch.errorMessage,
    }));
  }, [launches]);

  const columns = React.useMemo(
    () =>
      createColumns({
        onReclaim: (row) => {
          if (row.publicKey) {
            setReclaimTarget({ tokenPublicKey: row.publicKey });
          } else {
            setReclaimTarget({ launchId: row.launchId });
          }
        },
      }),
    []
  );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="My Tokens"
        rightContent={
          <Button asChild>
            <Link href="/launch">
              <Plus className="size-4" />
              Launch New Token
            </Link>
          </Button>
        }
      />

      <div />

      <DataTable
        columns={columns}
        data={tableRows}
        isLoading={isLoading}
        getRowId={(row) => row.id}
        searchableColumns={["token", "publicKey"]}
        toolbar={(table) => (
          <div className="flex items-center justify-between gap-2">
            <DataTableSearch
              table={table}
              placeholder="Search tokens..."
              className="max-w-sm"
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
