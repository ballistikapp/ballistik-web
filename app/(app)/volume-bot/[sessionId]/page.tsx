"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { useQueryState } from "nuqs";
import { formatDistanceToNowStrict } from "date-fns";
import { toast } from "sonner";
import { tokenQueryParser } from "@/lib/utils/token-query";
import { trpc } from "@/lib/trpc/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TokenNotFound } from "@/components/placeholders/token-not-found";
import { DashboardLoading } from "../../dashboard/dashboard-loading";
import { Separator } from "@/components/ui/separator";
import type { VolumeBotConfigInput } from "@/server/schemas/volume-bot.schema";

export default function VolumeBotRunPage() {
  const params = useParams();
  const sessionId = params?.sessionId as string;
  const [tokenPublicKey] = useQueryState("token", tokenQueryParser);

  const {
    data: statusData,
    isLoading,
    error,
    refetch,
  } = trpc.volumeBot.status.useQuery(
    { sessionId: sessionId || "" },
    {
      enabled: Boolean(sessionId),
      refetchInterval: 2500,
      staleTime: 5000,
      retry: false,
    }
  );

  const logsQuery = trpc.volumeBot.logs.useQuery(
    { sessionId: sessionId || "" },
    {
      enabled: Boolean(sessionId),
      refetchInterval: 2500,
      staleTime: 2000,
      retry: false,
    }
  );

  const stopMutation = trpc.volumeBot.stop.useMutation({
    onSuccess: () => {
      toast.success("Stop requested");
      refetch();
    },
    onError: (error) => {
      toast.error(error.message || "Failed to stop volume bot");
    },
  });

  const reclaimMutation = trpc.volumeBot.reclaim.useMutation({
    onSuccess: () => {
      toast.success("Reclaim requested");
    },
    onError: (error) => {
      toast.error(error.message || "Failed to reclaim funds");
    },
  });

  const closeAccountsMutation = trpc.volumeBot.closeAccounts.useMutation({
    onSuccess: () => {
      toast.success("Close accounts requested");
    },
    onError: (error) => {
      toast.error(error.message || "Failed to close accounts");
    },
  });

  const session = statusData?.session;
  const wallets = statusData?.wallets ?? [];
  const logs = logsQuery.data ?? [];
  const backToken = tokenPublicKey || session?.tokenPublicKey;
  const backHref = backToken ? `/volume-bot?token=${backToken}` : "/volume-bot";
  const config = session?.config as VolumeBotConfigInput | undefined;
  const ranges = config?.ranges ?? [];
  const netSolDirection = ranges.reduce((sum, range) => {
    const avgAmount = (range.solMin + range.solMax) / 2;
    if (range.direction === "buy") {
      return sum + range.probability * avgAmount;
    }
    if (range.direction === "sell") {
      return sum - range.probability * avgAmount;
    }
    const buyProbability = range.buyProbability ?? 0;
    return sum + range.probability * avgAmount * (2 * buyProbability - 1);
  }, 0);
  const netDirectionLabel =
    netSolDirection > 0 ? "Net buy" : netSolDirection < 0 ? "Net sell" : "Neutral";
  const netSol = Number(session?.totalPnlSol ?? 0);
  const [runtimeSeconds, setRuntimeSeconds] = useState(
    session?.runtimeSeconds ?? 0
  );

  const handleStop = async () => {
    if (!session) {
      return;
    }
    await stopMutation.mutateAsync({ sessionId: session.id });
  };

  const handleReclaim = async () => {
    if (!session) {
      return;
    }
    await reclaimMutation.mutateAsync({ sessionId: session.id });
  };

  const handleCloseAccounts = async () => {
    if (!session) {
      return;
    }
    await closeAccountsMutation.mutateAsync({ sessionId: session.id });
  };

  useEffect(() => {
    if (!session) {
      return;
    }
    const baseRuntime = session.runtimeSeconds ?? 0;
    const startedAt = Date.now();
    setRuntimeSeconds(baseRuntime);
    const interval = setInterval(() => {
      const elapsed = Math.floor((Date.now() - startedAt) / 1000);
      setRuntimeSeconds(baseRuntime + elapsed);
    }, 1000);
    return () => clearInterval(interval);
  }, [session?.runtimeSeconds, session?.status, session?.id]);

  if (isLoading) {
    return <DashboardLoading />;
  }

  if (!session) {
    return <TokenNotFound error={error} onRetry={() => refetch()} />;
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex justify-between items-center gap-2 -m-6 px-6 py-10 border-b">
        <div className="flex flex-col gap-3">
          <Link
            href={backHref}
            className="text-sm text-muted-foreground hover:underline"
          >
            Back to runs
          </Link>
          <h1 className="text-4xl">Volume Bot Run</h1>
          <div className="text-sm text-muted-foreground font-mono">
            {session.id}
          </div>
        </div>
        <div className="flex flex-col items-end gap-3 text-right text-muted-foreground">
          <p className="leading-tight font-light">
            Live session activity and wallet health.
            <br />
            Status updates refresh every few seconds.
          </p>
        </div>
      </div>

      <div />

      <Card>
        <CardHeader>
          <CardTitle className="text-primary text-xl">Status</CardTitle>
        </CardHeader>
        <Separator />
        <CardContent className="space-y-6">
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleReclaim}
              disabled={reclaimMutation.isPending}
            >
              Reclaim
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleCloseAccounts}
              disabled={closeAccountsMutation.isPending}
            >
              Close accounts
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={handleStop}
              disabled={stopMutation.isPending}
            >
              Stop
            </Button>
          </div>
          <div className="grid gap-3 md:grid-cols-4">
            <div>
              <div className="text-xs text-muted-foreground">Status</div>
              <div className="text-sm font-semibold">{session.status}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Trades</div>
              <div className="text-sm font-semibold">{session.totalTrades}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Volume (USD)</div>
              <div className="text-sm font-semibold">
                {Number(session.totalVolumeUsd).toFixed(2)}
              </div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Runtime (sec)</div>
              <div className="text-sm font-semibold">{runtimeSeconds}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Net direction</div>
              <div className="text-sm font-semibold">{netDirectionLabel}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Net SOL</div>
              <div className="text-sm font-semibold">{netSol.toFixed(3)}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Ranges</div>
              <div className="text-sm font-semibold">{ranges.length}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Duration (sec)</div>
              <div className="text-sm font-semibold">
                {config?.targetDurationSeconds ?? "—"}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-primary text-xl">Ranges</CardTitle>
        </CardHeader>
        <Separator />
        <CardContent className="space-y-2">
          {ranges.length === 0 && (
            <div className="text-sm text-muted-foreground">
              No ranges configured.
            </div>
          )}
          {ranges.map((range, index) => (
            <div
              key={`${range.solMin}-${range.solMax}-${index}`}
              className="flex items-center justify-between rounded border px-3 py-2 text-sm"
            >
              <div>
                Range {index + 1}: {range.solMin.toFixed(3)}-
                {range.solMax.toFixed(3)} SOL
              </div>
              <div className="text-xs text-muted-foreground text-right">
                prob {range.probability.toFixed(2)} · interval{" "}
                {range.intervalMin}-{range.intervalMax}s · {range.direction}
                {range.direction === "both" &&
                  ` (${(range.buyProbability ?? 0).toFixed(2)} buy)`}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-primary text-xl">Wallets</CardTitle>
        </CardHeader>
        <Separator />
        <CardContent className="space-y-2">
          {wallets.slice(0, 10).map((wallet) => (
            <div
              key={wallet.id}
              className="flex items-center justify-between rounded border px-3 py-2 text-sm"
            >
              <div className="font-mono">
                {wallet.walletPublicKey.slice(0, 8)}...
                {wallet.walletPublicKey.slice(-6)}
              </div>
              <div className="text-muted-foreground">{wallet.status}</div>
              <div>{Number(wallet.solBalance).toFixed(4)} SOL</div>
            </div>
          ))}
          {wallets.length > 10 && (
            <div className="text-xs text-muted-foreground">
              +{wallets.length - 10} more wallets
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-primary text-xl">Live feed</CardTitle>
        </CardHeader>
        <Separator />
        <CardContent className="space-y-2">
          {logs.length === 0 && (
            <div className="text-sm text-muted-foreground">No trades yet.</div>
          )}
          {logs.map((log) => (
            <div
              key={log.id}
              className="flex items-center justify-between rounded border px-3 py-2 text-sm"
            >
              <div className="flex flex-col">
                <div className="font-semibold capitalize">{log.type}</div>
                <div className="text-xs text-muted-foreground">
                  {(() => {
                    const data = log.data as
                      | { tradeAmountSol?: number; netSolChangeSol?: number }
                      | undefined;
                    const tradeAmount =
                      typeof data?.tradeAmountSol === "number"
                        ? data.tradeAmountSol
                        : null;
                    const netSolChange =
                      typeof data?.netSolChangeSol === "number"
                        ? data.netSolChangeSol
                        : null;
                    if (tradeAmount !== null) {
                      return `Trade ${tradeAmount.toFixed(3)} SOL${
                        netSolChange !== null
                          ? ` • Net ${netSolChange.toFixed(3)} SOL`
                          : ""
                      }`;
                    }
                    return log.message;
                  })()}
                </div>
              </div>
              <div className="text-xs text-muted-foreground">
                {formatDistanceToNowStrict(new Date(log.createdAt))} ago
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
