"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { formatDistanceToNowStrict } from "date-fns";
import { trpc } from "@/lib/trpc/client";
import { TokenNotFound } from "@/components/placeholders/token-not-found";
import { DashboardLoading } from "../../dashboard/dashboard-loading";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

const typeLabels: Record<string, string> = {
  BUY: "Buy",
  SELL: "Sell",
  CREATE: "Create",
};

type FilterMode = "all" | "owned" | "foreign";

function formatRelativeTime(dateValue?: Date | string | null) {
  if (!dateValue) return "Never";
  const date = typeof dateValue === "string" ? new Date(dateValue) : dateValue;
  if (Number.isNaN(date.getTime())) return "Never";
  return `${formatDistanceToNowStrict(date)} ago`;
}

function truncateSignature(value: string) {
  if (value.length <= 12) return value;
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

export default function LiveTransactionsPage() {
  const { tokenPublicKey } = useParams<{ tokenPublicKey: string }>();
  const [filter, setFilter] = useState<FilterMode>("all");

  const {
    data: tokenData,
    isLoading,
    error,
    refetch,
  } = trpc.token.getByPublicKey.useQuery(
    { publicKey: tokenPublicKey || "" },
    { enabled: !!tokenPublicKey }
  );

  const liveQuery = trpc.transaction.liveByToken.useQuery(
    { tokenPublicKey: tokenPublicKey || "", limit: 80 },
    {
      enabled: !!tokenPublicKey && !!tokenData,
      refetchInterval: 2000,
      staleTime: 1000,
      retry: false,
    }
  );

  const transactions = liveQuery.data?.transactions ?? [];
  const totals = liveQuery.data?.totals ?? {
    totalLiquiditySol: 0,
    foreignLiquiditySol: 0,
  };
  const streamStatus = liveQuery.data?.streamStatus ?? null;

  const counts = useMemo(() => {
    const owned = transactions.filter((tx) => tx.isOwned).length;
    const foreign = transactions.length - owned;
    return { owned, foreign, all: transactions.length };
  }, [transactions]);

  const filteredTransactions = useMemo(() => {
    if (filter === "owned") {
      return transactions.filter((tx) => tx.isOwned);
    }
    if (filter === "foreign") {
      return transactions.filter((tx) => !tx.isOwned);
    }
    return transactions;
  }, [filter, transactions]);

  if (isLoading) {
    return <DashboardLoading />;
  }

  if (!tokenData) {
    return <TokenNotFound error={error} onRetry={() => refetch()} />;
  }

  const listHref = tokenPublicKey
    ? `/${tokenPublicKey}/transactions`
    : "/transactions";

  return (
    <div className="flex flex-col gap-6">
      <div className="flex justify-between items-center gap-2 -m-6 px-6 py-10 border-b">
        <div className="flex flex-col gap-3">
          <Link
            href={listHref}
            className="text-sm text-muted-foreground hover:underline"
          >
            Back to transactions
          </Link>
          <h1 className="text-4xl">Live Transactions</h1>
          <div className="text-sm text-muted-foreground">
            Streaming activity across all wallets for {tokenData.symbol}.
          </div>
        </div>
        <div className="text-right text-muted-foreground">
          <p className="leading-tight font-light">
            Live updates refresh every few seconds.
            <br />
            Foreign wallets stay highlighted.
          </p>
        </div>
      </div>

      <div />

      <Card>
        <CardHeader>
          <CardTitle className="text-primary text-xl">Totals</CardTitle>
        </CardHeader>
        <Separator />
        <CardContent className="grid gap-4 md:grid-cols-2">
          <div>
            <div className="text-xs text-muted-foreground">
              Total liquidity (SOL)
            </div>
            <div className="text-sm font-semibold">
              {totals.totalLiquiditySol.toFixed(3)}
            </div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">
              Foreign liquidity (SOL)
            </div>
            <div className="text-sm font-semibold">
              {totals.foreignLiquiditySol.toFixed(3)}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-primary text-xl">Live feed</CardTitle>
        </CardHeader>
        <Separator />
        <CardContent className="space-y-4">
          {streamStatus && !streamStatus.connected && (
            <div className="rounded border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
              RabbitStream unavailable:{" "}
              {streamStatus.lastError ?? "Not connected"}
            </div>
          )}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <ToggleGroup
              type="single"
              value={filter}
              onValueChange={(value) => {
                if (!value) return;
                setFilter(value as FilterMode);
              }}
            >
              <ToggleGroupItem value="all">All ({counts.all})</ToggleGroupItem>
              <ToggleGroupItem value="owned">
                Owned ({counts.owned})
              </ToggleGroupItem>
              <ToggleGroupItem value="foreign">
                Foreign ({counts.foreign})
              </ToggleGroupItem>
            </ToggleGroup>
            <div className="text-xs text-muted-foreground">
              Showing {filteredTransactions.length} transactions
            </div>
          </div>

          {filteredTransactions.length === 0 && (
            <div className="text-sm text-muted-foreground">
              Waiting for live transactions...
            </div>
          )}

          {filteredTransactions.map((tx) => {
            const timeLabel = formatRelativeTime(tx.blockTime ?? tx.seenAt);
            const typeLabel =
              typeLabels[tx.transactionType] ?? tx.transactionType;
            const walletLink = tokenPublicKey
              ? `/${tokenPublicKey}/wallets/${tx.walletPublicKey}`
              : `/wallets/${tx.walletPublicKey}`;
            return (
              <div
                key={`${tx.transactionSignature}-${tx.walletPublicKey}`}
                className={`flex flex-col gap-3 rounded border px-3 py-2 text-sm ${
                  tx.isOwned ? "" : "border-destructive/50 bg-destructive/5"
                }`}
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex flex-col gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant={tx.isOwned ? "secondary" : "destructive"}>
                        {tx.isOwned ? "Owned" : "Foreign"}
                      </Badge>
                      <Badge variant="outline">{typeLabel}</Badge>
                      {!tx.isOwned && <Badge variant="outline">External</Badge>}
                      {tx.walletType && (
                        <Badge variant="outline">{tx.walletType}</Badge>
                      )}
                      {tx.status === "FAILED" && (
                        <Badge variant="destructive">Failed</Badge>
                      )}
                    </div>
                    <div className="font-mono text-xs">
                      {truncateSignature(tx.walletPublicKey)}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {Number(tx.solAmount).toFixed(4)} SOL ·{" "}
                      {Number(tx.tokenAmount).toFixed(4)} {tokenData.symbol} ·{" "}
                      {Number(tx.pricePerToken).toFixed(6)}
                    </div>
                  </div>

                  <div className="flex flex-col items-end gap-2">
                    <div className="text-xs text-muted-foreground">
                      {timeLabel}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button asChild variant="outline" size="sm">
                        <a
                          href={`https://solscan.io/tx/${tx.transactionSignature}`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          View tx
                        </a>
                      </Button>
                      <Button asChild variant="outline" size="sm">
                        <a
                          href={`https://solscan.io/account/${tx.walletPublicKey}`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          View wallet
                        </a>
                      </Button>
                      {tx.isOwned && (
                        <Button asChild size="sm">
                          <Link href={walletLink}>Open wallet</Link>
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}
