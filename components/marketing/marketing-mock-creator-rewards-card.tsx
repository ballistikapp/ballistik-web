"use client";

import { IconGift, IconRefresh } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { formatSol } from "@/lib/utils/format";

function formatTimeAgo(date: Date | string | null | undefined): string {
  if (!date) return "Never";
  const d = typeof date === "string" ? new Date(date) : date;
  const seconds = Math.floor((Date.now() - d.getTime()) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  return `${Math.floor(seconds / 3600)}h ago`;
}

export function MarketingMockCreatorRewardsCard({
  claimableSol,
  paidOutSol,
  lastReconciledAt,
}: {
  claimableSol: number;
  paidOutSol: number;
  lastReconciledAt: Date | string;
}) {
  const hasClaimable = claimableSol > 0;

  return (
    <div className="flex h-full flex-col gap-2 rounded-lg border bg-card px-3 py-2.5 text-sm">
      <TooltipProvider>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <IconGift className="size-3.5" />
          <span>Creator rewards</span>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1.5">
            <span
              className={`size-2 shrink-0 rounded-full ${
                hasClaimable ? "bg-green-500" : "bg-muted-foreground/40"
              }`}
            />
            <div className="flex items-center gap-1">
              <span className="font-mono text-sm font-semibold tabular-nums">
                {formatSol(claimableSol)} SOL
              </span>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
                    disabled
                    aria-label="Refresh creator rewards"
                  >
                    <IconRefresh className="size-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="top" className="text-xs">
                  Preview only
                </TooltipContent>
              </Tooltip>
            </div>
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="cursor-help tabular-nums text-muted-foreground">
                  {formatTimeAgo(lastReconciledAt)}
                </span>
              </TooltipTrigger>
              <TooltipContent side="top" className="max-w-xs text-xs">
                Last refreshed from on-chain transactions
                {paidOutSol > 0
                  ? `. Total paid out: ${formatSol(paidOutSol)} SOL`
                  : ""}
              </TooltipContent>
            </Tooltip>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button
              variant="default"
              size="sm"
              className="h-8 px-3 text-xs font-semibold"
              disabled
            >
              Claim
            </Button>
          </div>
        </div>
      </TooltipProvider>
    </div>
  );
}
