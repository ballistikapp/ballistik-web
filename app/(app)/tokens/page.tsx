"use client";

import Link from "next/link";
import { Plus } from "lucide-react";
import { trpc } from "@/lib/trpc/client";
import {
  DataTable,
  DataTablePagination,
  DataTableSearch,
  DataTableViewOptions,
} from "@/components/data-table";
import { Button } from "@/components/ui/button";
import { columns } from "./columns";

export default function ManageTokensPage() {
  const { data: tokens, isLoading } = trpc.token.getUserTokens.useQuery();

  return (
    <div className="flex flex-col gap-6">
      <div className="-m-6 px-6 py-10 border-b">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-4xl">Your Tokens</h1>
            {!isLoading && tokens && (
              <p className="text-muted-foreground mt-1">
                {tokens.length} {tokens.length === 1 ? "token" : "tokens"}
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
        data={tokens ?? []}
        isLoading={isLoading}
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
    </div>
  );
}
