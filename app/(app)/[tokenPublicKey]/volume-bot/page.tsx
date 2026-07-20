"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useParams } from "next/navigation";
import { trpc } from "@/lib/trpc/client";
import { TokenNotFound } from "@/components/placeholders/token-not-found";
import { DashboardLoading } from "../dashboard/dashboard-loading";
import {
  DataTable,
  DataTablePagination,
  DataTableSearch,
  DataTableViewOptions,
} from "@/components/data-table";
import { PageHeader } from "@/components/layout/sections";
import { Button } from "@/components/ui/button";
import { legacyCapabilityDeniedMessage } from "@/lib/launch/legacy-capability";
import { getColumns } from "./columns";
import { PlusIcon } from "lucide-react";

export default function VolumeBotPage() {
  const { tokenPublicKey } = useParams<{ tokenPublicKey: string }>();

  const {
    data: tokenData,
    isLoading,
    error,
    refetch,
  } = trpc.token.getByPublicKey.useQuery(
    { publicKey: tokenPublicKey || "" },
    { enabled: !!tokenPublicKey }
  );

  const { data: sessionsData, isLoading: sessionsLoading } =
    trpc.volumeBot.listSessions.useQuery(
      { tokenPublicKey: tokenPublicKey || undefined, limit: 50 },
      { enabled: !!tokenPublicKey && !!tokenData }
    );

  const columns = useMemo(
    () => getColumns({ tokenPublicKey }),
    [tokenPublicKey]
  );
  const sessions = sessionsData ?? [];
  const newRunHref = tokenPublicKey
    ? `/${tokenPublicKey}/volume-bot/new`
    : "/volume-bot/new";

  if (isLoading) {
    return <DashboardLoading />;
  }

  if (!tokenData) {
    return <TokenNotFound error={error} onRetry={() => refetch()} />;
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Volume Bot Sessions"
        rightContent={
          <div className="flex w-full flex-col items-start gap-3 text-left text-muted-foreground md:items-end md:text-right">
            <Button
              asChild={!tokenData.isMayhemMode && !tokenData.isLegacy}
              size="lg"
              disabled={tokenData.isMayhemMode || tokenData.isLegacy}
            >
              {tokenData.isMayhemMode || tokenData.isLegacy ? (
                <span>
                  <PlusIcon strokeWidth={2.5} className="size-5 mr-1.5" />
                  <span className="font-semibold">New Session</span>
                </span>
              ) : (
                <Link href={newRunHref}>
                  <PlusIcon strokeWidth={2.5} className="size-5 mr-1.5" />
                  <span className="font-semibold">New Session</span>
                </Link>
              )}
            </Button>
            {tokenData.isLegacy ? (
              <p className="text-xs text-amber-500">
                {legacyCapabilityDeniedMessage("automation")}
              </p>
            ) : tokenData.isMayhemMode ? (
              <p className="text-xs text-amber-500">
                Not yet supported for Mayhem-mode tokens.
              </p>
            ) : null}
          </div>
        }
      />
      <div className="pt-6" />

      <DataTable
        columns={columns}
        data={sessions}
        isLoading={sessionsLoading}
        enableUrlState
        urlStatePrefix="volumeBotSessions"
        searchableColumns={["status"]}
        toolbar={(table) => (
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <DataTableSearch
              table={table}
              placeholder="Search sessions..."
              className="w-full sm:max-w-sm"
            />
            <DataTableViewOptions table={table} />
          </div>
        )}
        pagination={(table) => <DataTablePagination table={table} />}
      />
    </div>
  );
}
