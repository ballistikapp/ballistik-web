"use client";

import { useQueryState } from "nuqs";
import { tokenQueryParser } from "@/lib/utils/token-query";
import { trpc } from "@/lib/trpc/client";
import { TokenNotFound } from "@/components/placeholders/token-not-found";
import { DashboardLoading } from "../dashboard/dashboard-loading";
import {
  DataTable,
  DataTablePagination,
  DataTableViewOptions,
  DataTableSearch,
} from "@/components/data-table";
import { columns } from "./columns";

export default function Page() {
  const [tokenPublicKey] = useQueryState("token", tokenQueryParser);

  const {
    data: tokenData,
    isLoading: tokenLoading,
    error: tokenError,
    refetch: refetchToken,
  } = trpc.token.getByPublicKey.useQuery(
    { publicKey: tokenPublicKey || "" },
    { enabled: !!tokenPublicKey }
  );

  const { data: wallets, isLoading: walletsLoading } =
    trpc.wallet.getByToken.useQuery(
      { tokenPublicKey: tokenPublicKey || "" },
      { enabled: !!tokenPublicKey && !!tokenData }
    );

  if (tokenLoading) {
    return <DashboardLoading />;
  }

  if (!tokenData) {
    return (
      <TokenNotFound
        error={tokenError as Error | null}
        onRetry={() => refetchToken()}
      />
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex justify-between items-center gap-2 -m-6 px-6 py-10 border-b">
        <h1 className="text-4xl">Token Wallets</h1>
        <p className="leading-tight font-light text-right text-muted-foreground">
          View your token wallets.
          <br />
          Manage wallets associated with this token.
        </p>
      </div>

      <div className="h-6" />
      <DataTable
        columns={columns}
        data={wallets || []}
        isLoading={walletsLoading}
        enableRowSelection
        getRowId={(row) => row.publicKey}
        searchableColumns={["publicKey", "type"]}
        enableUrlState
        urlStatePrefix="wallets"
        toolbar={(table) => (
          <div className="flex items-center justify-between gap-2">
            <DataTableSearch
              table={table}
              placeholder="Search wallets..."
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
