"use client";

import { SectionCards } from "@/components/template/section-cards";
import { ChartAreaInteractive } from "@/components/template/chart-area-interactive";
import { DataTable } from "@/components/data-table/data-table";
import { DataTablePagination } from "@/components/data-table/data-table-pagination";
import { DataTableViewOptions } from "@/components/data-table/data-table-view-options";
import { columns, type Task } from "./columns";
import data from "./data.json";
import { GalleryVerticalEnd, ExternalLink } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useQueryState } from "nuqs";
import { tokenQueryParser } from "@/lib/utils/token-query";
import { trpc } from "@/lib/trpc/client";
import { TokenNotFound } from "@/components/placeholders/token-not-found";
import { DashboardLoading } from "./dashboard-loading";

export function DashboardClient() {
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

  if (isLoading) {
    return <DashboardLoading />;
  }

  if (!tokenData) {
    return <TokenNotFound error={error} onRetry={() => refetch()} />;
  }

  return (
    <div className="flex flex-col gap-12">
      <div className="flex justify-between items-start gap-6 -m-6 px-6 py-6 border-b">
        <div className="flex flex-col gap-2 flex-1">
          <div className="flex flex-col gap-1">
            <h1 className="text-4xl">{tokenData.name}</h1>
            <span className="text-muted-foreground text-2xl">
              {`${tokenData.symbol}`}
            </span>
          </div>
          {tokenData.description && (
            <p className="text-muted-foreground italic opacity-70 text-xs sm:text-sm max-w-2xl">
              {tokenData.description}
            </p>
          )}
          {(tokenData.twitterUrl ||
            tokenData.telegramUrl ||
            tokenData.websiteUrl) && (
            <div className="flex flex-wrap gap-2 mt-2">
              {tokenData.twitterUrl && (
                <Link
                  href={tokenData.twitterUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-muted hover:bg-muted/80 text-sm text-foreground transition-colors"
                >
                  Twitter
                  <ExternalLink className="size-3.5" />
                </Link>
              )}
              {tokenData.telegramUrl && (
                <Link
                  href={tokenData.telegramUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-muted hover:bg-muted/80 text-sm text-foreground transition-colors"
                >
                  Telegram
                  <ExternalLink className="size-3.5" />
                </Link>
              )}
              {tokenData.websiteUrl && (
                <Link
                  href={tokenData.websiteUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-muted hover:bg-muted/80 text-sm text-foreground transition-colors"
                >
                  Website
                  <ExternalLink className="size-3.5" />
                </Link>
              )}
            </div>
          )}
        </div>
        <div className="bg-sidebar-primary text-sidebar-primary-foreground relative flex items-center justify-center rounded-lg overflow-hidden shrink-0 aspect-square size-40">
          {tokenData.imageUrl ? (
            <Image
              src={tokenData.imageUrl}
              alt={tokenData.name || "Token"}
              className="object-contain"
              fill
              loading="lazy"
            />
          ) : (
            <GalleryVerticalEnd className="size-6" />
          )}
        </div>
      </div>
      <SectionCards />
      <ChartAreaInteractive />
      <DataTable
        columns={columns}
        data={data as Task[]}
        enableRowSelection
        getRowId={(row) => row.id.toString()}
        toolbar={(table) => (
          <div className="flex items-center justify-end">
            <DataTableViewOptions table={table} />
          </div>
        )}
        pagination={(table) => <DataTablePagination table={table} />}
      />
    </div>
  );
}
