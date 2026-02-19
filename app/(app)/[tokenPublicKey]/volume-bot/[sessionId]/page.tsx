"use client";

import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc/client";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { TokenNotFound } from "@/components/placeholders/token-not-found";
import { DashboardLoading } from "../../dashboard/dashboard-loading";
import { Separator } from "@/components/ui/separator";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DataTable,
  DataTablePagination,
  DataTableSearch,
  DataTableViewOptions,
} from "@/components/data-table";
import {
  TrendingDownIcon,
  TrendingUpIcon,
  MinusIcon,
  PlayIcon,
  SquareIcon,
  ClockIcon,
  PauseIcon,
  CircleAlertIcon,
  LoaderIcon,
  WalletIcon,
} from "lucide-react";
import {
  getTransactionsColumns,
  type VolumeBotLogRow,
} from "./transactions-columns";
import {
  getWalletColumns,
  type SessionWalletRow,
} from "./wallet-columns";
import type { VolumeBotConfigInput } from "@/server/schemas/volume-bot.schema";

type RangeConfig = VolumeBotConfigInput["ranges"][number];

function formatDuration(seconds: number) {
  if (!Number.isFinite(seconds) || seconds <= 0) return "—";
  const totalMinutes = Math.floor(seconds / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0 && minutes > 0) return `${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h`;
  return `${minutes}m`;
}

function formatDirection(range: RangeConfig) {
  if (range.direction === "both") {
    return `Both (${((range.buyProbability ?? 0) * 100).toFixed(0)}% buy)`;
  }
  return range.direction === "buy" ? "Buy" : "Sell";
}

export default function VolumeBotRunPage() {
  const params = useParams<{ tokenPublicKey: string; sessionId: string }>();
  const tokenPublicKey = params?.tokenPublicKey;
  const sessionId = params?.sessionId;
  const {
    data: statusData,
    isLoading,
    error,
    refetch,
  } = trpc.volumeBot.status.useQuery(
    { sessionId: sessionId || "" },
    {
      enabled: Boolean(sessionId),
      refetchInterval: 5000,
      staleTime: 3000,
      retry: false,
    }
  );

  const logsQuery = trpc.volumeBot.logs.useQuery(
    { sessionId: sessionId || "" },
    {
      enabled: Boolean(sessionId),
      refetchInterval: 5000,
      staleTime: 3000,
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

  const session = statusData?.session;
  const wallets = statusData?.wallets ?? [];
  const rangeMetrics = statusData?.rangeMetrics ?? [];
  const logs = logsQuery.data ?? [];
  const netSol = Number(session?.totalPnlSol ?? 0);
  const netSolPerMinute = Number(session?.netDeltaSolPerMinute ?? 0);
  const config = session?.config as VolumeBotConfigInput | undefined;
  const ranges = config?.ranges ?? [];
  const behaviorConfig = config?.behaviorConfig;
  const [detailsDialogOpen, setDetailsDialogOpen] = useState(false);

  const transactionColumns = useMemo(
    () => getTransactionsColumns(tokenPublicKey || ""),
    [tokenPublicKey]
  );
  const walletColumns = useMemo(
    () => getWalletColumns(tokenPublicKey || ""),
    [tokenPublicKey]
  );
  const walletRows: SessionWalletRow[] = useMemo(
    () =>
      wallets.map((w) => ({
        id: w.id,
        walletPublicKey: w.walletPublicKey,
        walletType: (w as unknown as { wallet: { type: string } }).wallet?.type ?? "VOLUME",
        status: w.status,
        solBalance: Number(w.solBalance),
        tradesExecuted: w.tradesExecuted,
        pnlSol: Number(w.pnlSol),
        lastTradeAt: w.lastTradeAt ? new Date(w.lastTradeAt) : null,
      })),
    [wallets]
  );
  const logRows: VolumeBotLogRow[] = useMemo(
    () =>
      logs
        .filter((log) => {
          const type = log.type.toLowerCase();
          const message = log.message.toLowerCase();
          return !type.includes("eligibility") && !message.includes("eligibility");
        })
        .map((log) => ({
          id: log.id,
          level: log.level,
          type: log.type,
          message: log.message,
          data: log.data as VolumeBotLogRow["data"],
          walletPublicKey: log.walletPublicKey,
          signature: log.signature ?? null,
          createdAt: new Date(log.createdAt),
        })),
    [logs]
  );
  const [runtimeSeconds, setRuntimeSeconds] = useState(
    session?.runtimeSeconds ?? 0
  );

  const handleStop = async () => {
    if (!session) {
      return;
    }
    await stopMutation.mutateAsync({ sessionId: session.id });
  };

  const isActive =
    session?.status === "RUNNING" ||
    session?.status === "STOP_REQUESTED" ||
    session?.status === "STOPPING";

  useEffect(() => {
    if (!session) {
      return;
    }
    const baseRuntime = session.runtimeSeconds ?? 0;
    setRuntimeSeconds(baseRuntime);
    if (!isActive) {
      return;
    }
    const startedAt = Date.now();
    const interval = setInterval(() => {
      const elapsed = Math.floor((Date.now() - startedAt) / 1000);
      setRuntimeSeconds(baseRuntime + elapsed);
    }, 1000);
    return () => clearInterval(interval);
  }, [session?.runtimeSeconds, session?.status, session?.id, isActive]);

  if (isLoading) {
    return <DashboardLoading />;
  }

  if (!session) {
    return <TokenNotFound error={error} onRetry={() => refetch()} />;
  }

  return (
    <section className="pb-8">
      <div className="flex justify-between items-center gap-2 -mx-6 px-6 pt-6 pb-10 border-b">
        <h1 className="text-4xl">Volume Bot Session</h1>
        <div className="flex items-center gap-3">
          <span
            className={`inline-flex items-center gap-3 rounded-lg px-3 py-1.5 text-xl font-semibold ${
              session.status === "RUNNING"
                ? "bg-emerald-500/15 text-emerald-500"
                : session.status === "STOPPED"
                  ? "bg-muted text-muted-foreground"
                  : session.status === "FAILED"
                    ? "bg-red-500/15 text-red-500"
                    : session.status === "SCHEDULED"
                      ? "bg-amber-500/15 text-amber-500"
                      : session.status === "STOP_REQUESTED" ||
                          session.status === "STOPPING"
                        ? "bg-orange-500/15 text-orange-500"
                        : "bg-muted text-muted-foreground"
            }`}
          >
            {session.status === "RUNNING" ? (
              <PlayIcon className="size-4 fill-current" />
            ) : session.status === "STOPPED" ? (
              <SquareIcon className="size-4 fill-current" />
            ) : session.status === "FAILED" ? (
              <CircleAlertIcon className="size-4" />
            ) : session.status === "SCHEDULED" ? (
              <ClockIcon className="size-4" />
            ) : session.status === "STOP_REQUESTED" ||
              session.status === "STOPPING" ? (
              <LoaderIcon className="size-4 animate-spin" />
            ) : (
              <PauseIcon className="size-4" />
            )}
            {session.status}
          </span>
          {isActive && (
            <Button
              variant="destructive"
              size="sm"
              onClick={handleStop}
              disabled={stopMutation.isPending}
            >
              Stop
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4 mt-8">
        <div className="rounded-xl border border-border/70 bg-card px-4 py-3 shadow-sm">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
            Volume
          </p>
          <p className="mt-1 text-xl font-semibold tabular-nums">
            {Number(session.totalVolumeUsd).toFixed(2)} SOL
          </p>
          <p className="mt-1 text-xs text-muted-foreground/90">
            {session.totalTrades} transaction
            {session.totalTrades !== 1 ? "s" : ""}
          </p>
        </div>

        <div className="rounded-xl border border-border/70 bg-card px-4 py-3 shadow-sm">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
            Net SOL
          </p>
          <p className="mt-1 text-xl font-semibold tabular-nums flex items-center gap-1.5">
            {netSol > 0 ? (
              <TrendingUpIcon className="size-4 text-green-400" />
            ) : netSol < 0 ? (
              <TrendingDownIcon className="size-4 text-red-400" />
            ) : (
              <MinusIcon className="size-4 text-muted-foreground" />
            )}
            <span
              className={
                netSol > 0 ? "text-green-400" : netSol < 0 ? "text-red-400" : ""
              }
            >
              {netSol >= 0 ? "+" : ""}
              {netSol.toFixed(4)} SOL
            </span>
          </p>
          <p className="mt-1 text-xs text-muted-foreground/90">
            {netSolPerMinute >= 0 ? "+" : ""}
            {netSolPerMinute.toFixed(4)} SOL / min
          </p>
        </div>

        <div className="rounded-xl border border-border/70 bg-card px-4 py-3 shadow-sm">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
            Net Token
          </p>
          <p className="mt-1 text-xl font-semibold tabular-nums text-muted-foreground">
            —
          </p>
          <p className="mt-1 text-xs text-muted-foreground/90">
            Not tracked yet
          </p>
        </div>

        <div className="rounded-xl border border-border/70 bg-card px-4 py-3 shadow-sm">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
            Timing
          </p>
          <p className="mt-1 text-xl font-semibold tabular-nums">
            {Math.floor(runtimeSeconds / 3600) > 0
              ? `${Math.floor(runtimeSeconds / 3600)}h ${Math.floor((runtimeSeconds % 3600) / 60)}m`
              : `${Math.floor(runtimeSeconds / 60)}m ${runtimeSeconds % 60}s`}
          </p>
          <p className="mt-1 text-xs text-muted-foreground/90 space-y-0.5">
            {session.startedAt && (
              <span className="block">
                Started {format(new Date(session.startedAt), "MMM d, HH:mm")}
              </span>
            )}
            {session.scheduledStartAt && !session.startedAt && (
              <span className="block">
                Scheduled{" "}
                {format(new Date(session.scheduledStartAt), "MMM d, HH:mm")}
              </span>
            )}
            {!session.startedAt && !session.scheduledStartAt && (
              <span className="block">Not started</span>
            )}
          </p>
        </div>
      </div>

      <div className="-mx-6 my-14">
        <Separator />
      </div>

      <div className="space-y-5">
        <h2 className="text-2xl font-normal">Transactions</h2>
        <DataTable
          columns={transactionColumns}
          data={logRows}
          isLoading={logsQuery.isLoading}
          initialColumnVisibility={{ message: false }}
          searchableColumns={["walletPublicKey"]}
          toolbar={(table) => (
            <div className="flex items-center justify-between gap-2">
              <DataTableSearch
                table={table}
                placeholder="Search wallet public keys..."
                className="max-w-sm"
              />
              <DataTableViewOptions table={table} />
            </div>
          )}
          pagination={(table) => (
            <DataTablePagination table={table} showSelectedCount={false} />
          )}
        />
      </div>

      <div className="-mx-6 my-14">
        <Separator />
      </div>

      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h2 className="text-2xl font-normal">Details</h2>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setDetailsDialogOpen(true)}
          >
            <WalletIcon className="size-4 mr-1.5" />
            Wallets ({wallets.length})
          </Button>
        </div>

        {ranges.length > 0 && (
          <div className="space-y-3">
            {ranges.map((range, index) => {
              const metric = rangeMetrics[index];
              return (
                <div
                  key={index}
                  className={cn(
                    "rounded-lg border border-l-4 bg-card px-5 py-4",
                    range.direction === "buy" && "border-l-green-500",
                    range.direction === "sell" && "border-l-red-500",
                    range.direction === "both" && "border-l-muted-foreground/40"
                  )}
                >
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-semibold">
                        Range {index + 1}
                      </span>
                      <Badge
                        variant="outline"
                        className={cn(
                          "font-medium",
                          range.direction === "buy" &&
                            "border-emerald-500/30 bg-emerald-500/10 text-emerald-400",
                          range.direction === "sell" &&
                            "border-rose-500/30 bg-rose-500/10 text-rose-400",
                          range.direction === "both" &&
                            "border-border bg-muted/50 text-muted-foreground"
                        )}
                      >
                        {formatDirection(range)}
                      </Badge>
                    </div>
                    {metric && (
                      <span
                        className={cn(
                          "text-xs font-mono",
                          metric.expectedNetDeltaSolPerMinute > 0
                            ? "text-green-400"
                            : metric.expectedNetDeltaSolPerMinute < 0
                              ? "text-red-400"
                              : "text-muted-foreground"
                        )}
                      >
                        {metric.expectedNetDeltaSolPerMinute >= 0 ? "+" : ""}
                        {metric.expectedNetDeltaSolPerMinute.toFixed(4)} SOL/min
                        expected
                      </span>
                    )}
                  </div>

                  <div className="grid grid-cols-2 gap-x-8 gap-y-3 sm:grid-cols-4">
                    <div>
                      <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-0.5">
                        Trade Size
                      </p>
                      <p className="text-sm font-mono">
                        {range.solMin.toFixed(3)} – {range.solMax.toFixed(3)} SOL
                      </p>
                    </div>
                    <div>
                      <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-0.5">
                        Interval
                      </p>
                      <p className="text-sm font-mono">
                        {range.intervalMin} – {range.intervalMax}s
                      </p>
                    </div>
                    <div>
                      <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-0.5">
                        Step
                      </p>
                      <p className="text-sm font-mono">
                        {range.increment != null
                          ? `${range.increment.toFixed(3)} SOL`
                          : "—"}
                      </p>
                    </div>
                    {range.direction === "both" && (
                      <div>
                        <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-0.5">
                          Buy Probability
                        </p>
                        <p className="text-sm font-mono">
                          {((range.buyProbability ?? 0) * 100).toFixed(0)}%
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-lg border bg-card/50 px-3 py-2.5">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
              Scheduling
            </p>
            <p className="text-sm font-mono mt-0.5">
              <span className="font-semibold">
                {config ? formatDuration(config.targetDurationSeconds) : "—"}
              </span>
              {(session.scheduledStartAt || session.scheduledStopAt) && (
                <>
                  <span className="text-muted-foreground"> · </span>
                  <span className="text-xs text-muted-foreground">
                    {[
                      session.scheduledStartAt &&
                        `Start ${format(new Date(session.scheduledStartAt), "MMM d, HH:mm")}`,
                      session.scheduledStopAt &&
                        `End ${format(new Date(session.scheduledStopAt), "MMM d, HH:mm")}`,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </>
              )}
            </p>
          </div>
          <div className="rounded-lg border bg-card/50 px-3 py-2.5">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
              Slippage
            </p>
            <p className="text-sm font-mono mt-0.5">
              {behaviorConfig ? (
                <>
                  <span className="font-semibold">
                    {(behaviorConfig.slippageBps / 100).toFixed(1)}%
                  </span>
                  <span className="text-muted-foreground"> · </span>
                  <span className="text-xs text-muted-foreground">
                    {behaviorConfig.pauseOnHighSlippage
                      ? `Pause after ${behaviorConfig.maxSlippageFailures} failures`
                      : "No pause"}
                  </span>
                </>
              ) : (
                "—"
              )}
            </p>
          </div>
        </div>
      </div>

      <Dialog open={detailsDialogOpen} onOpenChange={setDetailsDialogOpen}>
        <DialogContent className="sm:max-w-4xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <WalletIcon className="size-5" />
              Session Wallets
            </DialogTitle>
          </DialogHeader>

          <DataTable
            columns={walletColumns}
            data={walletRows}
            pagination={(table) => (
              <DataTablePagination table={table} showSelectedCount={false} />
            )}
          />
        </DialogContent>
      </Dialog>
    </section>
  );
}
