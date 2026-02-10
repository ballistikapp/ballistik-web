"use client";

import Link from "next/link";
import { IconRobot, IconArrowsExchange, IconClock, IconPlus, IconList } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";

interface BotSession {
  id: string;
  status: string;
  totalTrades: number;
  totalPnlSol: number;
  runtimeSeconds: number;
  startedAt: string | Date | null;
  stoppedAt: string | Date | null;
  lastTickAt: string | Date | null;
  walletCount: number;
  activeWallets: number;
}

interface DashboardOperationsProps {
  operations: {
    botSessions: BotSession[];
  };
  tokenPublicKey: string;
}

function formatRuntime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const mins = Math.floor(seconds / 60);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  const remainMins = mins % 60;
  if (hours < 24) return `${hours}h ${remainMins}m`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
}

function formatSol(value: number): string {
  if (Math.abs(value) >= 1_000) return `${(value / 1_000).toFixed(2)}K`;
  if (Math.abs(value) < 0.0001 && value !== 0) return value.toExponential(2);
  return value.toFixed(4);
}

function formatTimeAgo(date: string | Date | null): string {
  if (!date) return "never";
  const diffMs = Date.now() - new Date(date).getTime();
  const diffSecs = Math.floor(diffMs / 1000);
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  if (diffSecs < 60) return `${diffSecs}s ago`;
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  return `${Math.floor(diffHours / 24)}d ago`;
}

function BotActions({ tokenPublicKey }: { tokenPublicKey: string }) {
  return (
    <div className="flex items-center gap-1.5 ml-auto shrink-0">
      <Button variant="outline" size="sm" className="h-7 gap-1.5 text-xs" asChild>
        <Link href={`/${tokenPublicKey}/volume-bot`}>
          <IconList className="size-3.5" />
          Sessions
        </Link>
      </Button>
      <Button variant="outline" size="sm" className="h-7 gap-1.5 text-xs" asChild>
        <Link href={`/${tokenPublicKey}/volume-bot/new`}>
          <IconPlus className="size-3.5" />
          New Session
        </Link>
      </Button>
    </div>
  );
}

export function DashboardOperations({
  operations,
  tokenPublicKey,
}: DashboardOperationsProps) {
  const activeSessions = operations.botSessions.filter(
    (s) =>
      s.status === "RUNNING" ||
      s.status === "STOPPING" ||
      s.status === "STOP_REQUESTED"
  );

  const lastFinished = operations.botSessions.find(
    (s) =>
      s.status === "STOPPED" ||
      s.status === "FAILED"
  );

  if (activeSessions.length > 0) {
    return (
      <div className="flex items-center gap-3 rounded-lg border bg-card px-4 py-2.5 text-sm">
        {activeSessions.map((bot) => (
          <div key={bot.id} className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-2">
              <span className="size-2 rounded-full bg-green-500 animate-pulse shrink-0" />
              <IconRobot className="size-4 text-muted-foreground" />
              <span className="font-medium">
                Volume bot running
              </span>
            </div>
            <span className="text-muted-foreground">·</span>
            <span className="flex items-center gap-1 tabular-nums text-muted-foreground">
              <IconArrowsExchange className="size-3.5" />
              {bot.totalTrades} trades
            </span>
            <span className="text-muted-foreground">·</span>
            <span
              className={`font-mono tabular-nums ${
                bot.totalPnlSol >= 0 ? "text-green-500" : "text-red-500"
              }`}
            >
              {bot.totalPnlSol >= 0 ? "+" : ""}
              {formatSol(bot.totalPnlSol)} SOL
            </span>
            <span className="text-muted-foreground">·</span>
            <span className="flex items-center gap-1 tabular-nums text-muted-foreground">
              <IconClock className="size-3.5" />
              {formatRuntime(bot.runtimeSeconds)}
            </span>
            <span className="text-muted-foreground">·</span>
            <span className="text-muted-foreground">
              {bot.activeWallets}/{bot.walletCount} wallets
            </span>
          </div>
        ))}
        <BotActions tokenPublicKey={tokenPublicKey} />
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3 rounded-lg border bg-card px-4 py-2.5 text-sm">
      <span className="size-2 rounded-full bg-muted-foreground/40 shrink-0" />
      <IconRobot className="size-4 text-muted-foreground" />
      <span className="text-muted-foreground">
        No active volume bot session.
      </span>
      {lastFinished ? (
        <>
          <span className="text-muted-foreground">Last session:</span>
          <span className="text-muted-foreground tabular-nums">
            {formatTimeAgo(lastFinished.stoppedAt ?? lastFinished.startedAt)}
          </span>
          <span className="text-muted-foreground">·</span>
          <span className="tabular-nums text-muted-foreground">
            {lastFinished.totalTrades} trades
          </span>
          <span className="text-muted-foreground">·</span>
          <span
            className={`font-mono tabular-nums ${
              lastFinished.totalPnlSol >= 0
                ? "text-green-500"
                : "text-red-500"
            }`}
          >
            {lastFinished.totalPnlSol >= 0 ? "+" : ""}
            {formatSol(lastFinished.totalPnlSol)} SOL
          </span>
          {lastFinished.status === "FAILED" && (
            <>
              <span className="text-muted-foreground">·</span>
              <span className="text-red-500">failed</span>
            </>
          )}
        </>
      ) : (
        <span className="text-muted-foreground">No previous sessions.</span>
      )}
      <BotActions tokenPublicKey={tokenPublicKey} />
    </div>
  );
}
