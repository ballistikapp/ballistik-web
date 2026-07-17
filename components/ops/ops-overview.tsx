"use client";

import { trpc } from "@/lib/trpc/client";
import { OpsLookupForm } from "@/components/ops/ops-lookup-form";
import { Skeleton } from "@/components/ui/skeleton";

const TILES = [
  { key: "newUsers7d", label: "New Users (7d)" },
  { key: "launches7d", label: "Launches (7d)" },
  { key: "failedLaunches7d", label: "Failed Launches (7d)" },
  { key: "totalUsers", label: "Total Users" },
  { key: "totalTokens", label: "Total Tokens" },
] as const;

export function OpsOverview() {
  const overviewQuery = trpc.ops.getOverview.useQuery({});

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Ops Overview</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Platform summary for Operators.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
        {TILES.map((tile) => (
          <div
            key={tile.key}
            className="border-border bg-muted/30 rounded-md border px-3 py-3"
          >
            <div className="text-muted-foreground text-xs tracking-wide uppercase">
              {tile.label}
            </div>
            <div className="mt-2 text-2xl font-semibold tabular-nums">
              {overviewQuery.isLoading ? (
                <Skeleton className="h-8 w-16" />
              ) : overviewQuery.isError ? (
                "—"
              ) : (
                overviewQuery.data?.[tile.key]
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="flex flex-col gap-3">
        <div>
          <h2 className="text-sm font-medium">Jump</h2>
          <p className="text-muted-foreground mt-1 text-xs">
            Paste a main-wallet pubkey, Wallet pubkey, or Token mint to open the
            matching Ops detail.
          </p>
        </div>
        <OpsLookupForm />
      </div>
    </div>
  );
}
