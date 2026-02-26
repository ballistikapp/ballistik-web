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
import { Button } from "@/components/ui/button";
import { createColumns, type TokenTableRow } from "./columns";
import { TokenReclaimDialog } from "./token-reclaim-dialog";

export default function ManageTokensPage() {
  const { data: tokens, isLoading: tokensLoading } =
    trpc.token.getAllUserTokens.useQuery();
  const {
    data: failedLaunches,
    isLoading: launchesLoading,
    error: failedLaunchesError,
  } = trpc.launch.getFailedLaunches.useQuery();

  React.useEffect(() => {
    if (failedLaunchesError) {
      console.error("getFailedLaunches error:", failedLaunchesError);
    }
  }, [failedLaunchesError]);

  const [reclaimTarget, setReclaimTarget] = React.useState<{
    tokenPublicKey?: string;
    launchId?: string;
  } | null>(null);

  const tableRows: TokenTableRow[] = React.useMemo(() => {
    const rows: TokenTableRow[] = [];
    const tokenPublicKeys = new Set<string>();

    if (tokens) {
      for (const token of tokens) {
        tokenPublicKeys.add(token.publicKey);
        rows.push({
          id: token.publicKey,
          name: token.name,
          symbol: token.symbol,
          status: (token.status ?? "ACTIVE") as TokenTableRow["status"],
          publicKey: token.publicKey,
          imageUrl: token.imageUrl,
          websiteUrl: token.websiteUrl,
          twitterUrl: token.twitterUrl,
          telegramUrl: token.telegramUrl,
          createdAt: token.createdAt,
        });
      }
    }

    if (failedLaunches) {
      for (const launch of failedLaunches) {
        if (launch.tokenPublicKey && tokenPublicKeys.has(launch.tokenPublicKey)) {
          const existingRow = rows.find(
            (r) => r.publicKey === launch.tokenPublicKey
          );
          if (existingRow) {
            existingRow.launchId = launch.launchId;
          }
          continue;
        }
        rows.push({
          id: launch.launchId,
          name: launch.tokenName,
          symbol: launch.tokenSymbol,
          status: "FAILED",
          publicKey: launch.tokenPublicKey,
          imageUrl: null,
          createdAt: launch.createdAt,
          launchId: launch.launchId,
          errorMessage: launch.errorMessage,
        });
      }
    }

    rows.sort((a, b) => {
      const dateA = new Date(a.createdAt).getTime();
      const dateB = new Date(b.createdAt).getTime();
      return dateB - dateA;
    });

    return rows;
  }, [tokens, failedLaunches]);

  const isLoading = tokensLoading || launchesLoading;

  const columns = React.useMemo(
    () =>
      createColumns({
        onReclaim: (row) => {
          if (row.publicKey) {
            setReclaimTarget({ tokenPublicKey: row.publicKey });
          } else if (row.launchId) {
            setReclaimTarget({ launchId: row.launchId });
          }
        },
      }),
    []
  );

  return (
    <div className="flex flex-col gap-6">
      <div className="-m-6 px-6 py-10 border-b">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-4xl">Your Tokens</h1>
            {!isLoading && (
              <p className="text-muted-foreground mt-1">
                {tableRows.length}{" "}
                {tableRows.length === 1 ? "token" : "tokens"}
              </p>
            )}
          </div>
          <Button asChild>
            <Link href="/launch">
              <Plus className="size-4" />
              Launch New Token
            </Link>
          </Button>
        </div>
      </div>

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
