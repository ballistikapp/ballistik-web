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
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
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
    <TooltipProvider>
      <div className="grid w-full shrink-0 grid-cols-2 gap-1.5 sm:ml-auto sm:flex sm:w-auto sm:items-center">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className="h-8 w-full px-0 sm:w-8"
              asChild
            >
              <Link
                href={`/${tokenPublicKey}/volume-bot`}
                aria-label="Sessions"
              >
                <IconList className="size-3.5" />
              </Link>
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top" className="text-xs">
            Sessions
          </TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className="h-8 w-full px-0 sm:w-8"
              asChild
            >
              <Link
                href={`/${tokenPublicKey}/volume-bot/new`}
                aria-label="New Session"
              >
                <IconPlus className="size-3.5" />
              </Link>
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top" className="text-xs">
            New Session
          </TooltipContent>
        </Tooltip>
      </div>
    </TooltipProvider>
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
    (s) => s.status === "STOPPED" || s.status === "FAILED"
  );

  if (activeSessions.length > 0) {
    return (
      <div className="flex h-full flex-col gap-2 rounded-lg border bg-card px-3 py-2.5 text-sm">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <IconRobot className="size-3.5" />
          <span>Volume bot</span>
        </div>
        {activeSessions.map((bot) => (
          <div
            key={bot.id}
            className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1.5">
              <div className="flex items-center gap-2">
                <span className="size-2 shrink-0 animate-pulse rounded-full bg-green-500" />
                <IconRobot className="size-4 text-muted-foreground" />
                <span className="font-medium">Volume bot running</span>
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
            <BotActions tokenPublicKey={tokenPublicKey} />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-2 rounded-lg border bg-card px-3 py-2.5 text-sm">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <IconRobot className="size-3.5" />
        <span>Volume bot</span>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1.5">
          <span className="size-2 rounded-full bg-muted-foreground/40 shrink-0" />
          <span className="text-muted-foreground">
            No active volume bot session.
          </span>
          {lastFinished ? (
            <>
              <span className="text-muted-foreground">Last session:</span>
              <span className="text-muted-foreground tabular-nums">
                {formatTimeAgo(
                  lastFinished.stoppedAt ?? lastFinished.startedAt ?? new Date()
                )}
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
              <SessionLink
                tokenPublicKey={tokenPublicKey}
                sessionId={lastFinished.id}
              />
              {lastFinished.status === "FAILED" && (
                <span className="text-red-500">failed</span>
              )}
            </>
          ) : null}
        </div>
        <BotActions tokenPublicKey={tokenPublicKey} />
      </div>
    </div>
  );
}
