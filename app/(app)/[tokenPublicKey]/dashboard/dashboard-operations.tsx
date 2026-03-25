"use client";

import Link from "next/link";
import {
  IconRobot,
  IconArrowsExchange,
  IconClock,
  IconPlus,
  IconList,
  IconExternalLink,
} from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { formatSol, formatRuntime, formatTimeAgo } from "@/lib/utils/format";

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

function BotActions({ tokenPublicKey }: { tokenPublicKey: string }) {
  return (
    <div className="grid w-full shrink-0 grid-cols-2 gap-1.5 sm:ml-auto sm:flex sm:w-auto sm:items-center">
      <Button
        variant="outline"
        size="sm"
        className="h-8 gap-1.5 text-xs"
        asChild
      >
        <Link href={`/${tokenPublicKey}/volume-bot`}>
          <IconList className="size-3.5" />
          Sessions
        </Link>
      </Button>
      <Button
        variant="outline"
        size="sm"
        className="h-8 gap-1.5 text-xs"
        asChild
      >
        <Link href={`/${tokenPublicKey}/volume-bot/new`}>
          <IconPlus className="size-3.5" />
          New Session
        </Link>
      </Button>
    </div>
  );
}

function SessionLink({
  tokenPublicKey,
  sessionId,
}: {
  tokenPublicKey: string;
  sessionId: string;
}) {
  return (
    <Link
      href={`/${tokenPublicKey}/volume-bot/${sessionId}`}
      className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground hover:underline transition-colors"
    >
      View session
      <IconExternalLink className="size-3.5" />
    </Link>
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
      <div className="flex flex-col gap-3 rounded-lg border bg-card px-4 py-3 text-sm sm:flex-row sm:items-start sm:justify-between">
        {activeSessions.map((bot) => (
          <div
            key={bot.id}
            className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1.5"
          >
            <div className="flex items-center gap-2">
              <span className="size-2 rounded-full bg-green-500 animate-pulse shrink-0" />
              <IconRobot className="size-4 text-muted-foreground" />
              <span className="font-medium">
                Volume bot running
              </span>
            </div>
            <span className="flex items-center gap-1 tabular-nums text-muted-foreground">
              <IconArrowsExchange className="size-3.5" />
              {bot.totalTrades} trades
            </span>
            <span
              className={`font-mono tabular-nums ${
                bot.totalPnlSol >= 0 ? "text-green-500" : "text-red-500"
              }`}
            >
              {bot.totalPnlSol >= 0 ? "+" : ""}
              {formatSol(bot.totalPnlSol)} SOL
            </span>
            <span className="flex items-center gap-1 tabular-nums text-muted-foreground">
              <IconClock className="size-3.5" />
              {formatRuntime(bot.runtimeSeconds)}
            </span>
            <span className="text-muted-foreground">
              {bot.activeWallets}/{bot.walletCount} wallets
            </span>
            <SessionLink tokenPublicKey={tokenPublicKey} sessionId={bot.id} />
          </div>
        ))}
        <BotActions tokenPublicKey={tokenPublicKey} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border bg-card px-4 py-3 text-sm sm:flex-row sm:items-start sm:justify-between">
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1.5">
        <span className="size-2 rounded-full bg-muted-foreground/40 shrink-0" />
        <IconRobot className="size-4 text-muted-foreground" />
        <span className="text-muted-foreground">
          No active volume bot session.
        </span>
        {lastFinished ? (
          <>
            <span className="text-muted-foreground">Last session:</span>
            <span className="text-muted-foreground tabular-nums">
              {formatTimeAgo(lastFinished.stoppedAt ?? lastFinished.startedAt ?? new Date())}
            </span>
            <span className="tabular-nums text-muted-foreground">
              {lastFinished.totalTrades} trades
            </span>
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
            <SessionLink tokenPublicKey={tokenPublicKey} sessionId={lastFinished.id} />
            {lastFinished.status === "FAILED" && (
              <span className="text-red-500">failed</span>
            )}
          </>
        ) : (
          <span className="text-muted-foreground">No previous sessions.</span>
        )}
      </div>
      <BotActions tokenPublicKey={tokenPublicKey} />
    </div>
  );
}
