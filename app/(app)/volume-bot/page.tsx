"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useQueryState } from "nuqs";
import { tokenQueryParser } from "@/lib/utils/token-query";
import { trpc } from "@/lib/trpc/client";
import { TokenNotFound } from "@/components/placeholders/token-not-found";
import { DashboardLoading } from "../dashboard/dashboard-loading";
import {
  DataTable,
  DataTablePagination,
  DataTableSearch,
  DataTableViewOptions,
} from "@/components/data-table";
import { Button } from "@/components/ui/button";
import { getColumns } from "./columns";

export default function VolumeBotPage() {
  const [tokenPublicKey] = useQueryState("token", tokenQueryParser);

  const {
    data: tokenData,
    isLoading,
    error,
    refetch,
  } = trpc.token.getByPublicKey.useQuery(
    { publicKey: tokenPublicKey || "" },
    { enabled: !!tokenPublicKey }
  );

  const {
    data: sessionsData,
    isLoading: sessionsLoading,
  } = trpc.volumeBot.listSessions.useQuery(
    { tokenPublicKey: tokenPublicKey || undefined, limit: 50 },
    { enabled: !!tokenPublicKey && !!tokenData }
  );

  const columns = useMemo(
    () => getColumns({ tokenPublicKey }),
    [tokenPublicKey]
  );
  const sessions = sessionsData ?? [];
  const newRunHref = tokenPublicKey
    ? `/volume-bot/new?token=${tokenPublicKey}`
    : "/volume-bot/new";

  if (isLoading) {
    return <DashboardLoading />;
  }

  if (!tokenData) {
    return <TokenNotFound error={error} onRetry={() => refetch()} />;
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex justify-between items-center gap-2 -m-6 px-6 py-10 border-b">
        <div>
          <h1 className="text-4xl">Volume Bot Runs</h1>
          <p className="mt-3 text-sm text-muted-foreground">
            Review and manage volume bot sessions for this token.
          </p>
        </div>
        <div className="flex flex-col items-end gap-3 text-right text-muted-foreground">
          <Button asChild size="sm">
            <Link href={newRunHref}>Start new run</Link>
          </Button>
        </div>
      </div>
      <div className="pt-6" />

      <DataTable
        columns={columns}
        data={sessions}
        isLoading={sessionsLoading}
        enableUrlState
        urlStatePrefix="volumeBotRuns"
        searchableColumns={["status"]}
        toolbar={(table) => (
          <div className="flex items-center justify-between gap-2">
            <DataTableSearch
              table={table}
              placeholder="Search runs..."
              className="max-w-sm"
            />
            <DataTableViewOptions table={table} />
          </div>
        )}
        pagination={(table) => <DataTablePagination table={table} />}
      />
    </div>
  );
}
