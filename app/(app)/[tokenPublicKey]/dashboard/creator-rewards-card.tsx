"use client";

import { useState } from "react";
import { IconGift, IconRefresh, IconLoader2 } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { formatSol } from "@/lib/utils/format";
import { trpc } from "@/lib/trpc/client";
import { toast } from "sonner";

interface CreatorRewardsCardProps {
  tokenPublicKey: string;
  onClaimSuccess: () => void;
}

function formatTimeAgo(date: Date | string | null | undefined): string {
  if (!date) return "Never";
  const d = typeof date === "string" ? new Date(date) : date;
  const seconds = Math.floor((Date.now() - d.getTime()) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  return `${Math.floor(seconds / 3600)}h ago`;
}

export function CreatorRewardsCard({
  tokenPublicKey,
  onClaimSuccess,
}: CreatorRewardsCardProps) {
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isClaiming, setIsClaiming] = useState(false);

  const rewardsQuery = trpc.creatorReward.getByToken.useQuery(
    { tokenPublicKey },
    { enabled: !!tokenPublicKey }
  );

  const refreshMutation = trpc.creatorReward.refreshByToken.useMutation();
  const claimMutation = trpc.creatorReward.claimByToken.useMutation();
  const refreshMainBalance = trpc.wallet.refreshMainBalance.useMutation();

  const rewards = rewardsQuery.data;
  const claimableSol = rewards?.claimableSol ?? 0;
  const paidOutSol = rewards?.paidOutSol ?? 0;
  const lastReconciledAt = rewards?.lastReconciledAt;
  const hasClaimable = claimableSol > 0;

  // Only mount after success so ineligible tokens never flash a loading card that then disappears.
  if (!rewardsQuery.isSuccess || !rewards?.eligible) {
    return null;
  }

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      await refreshMutation.mutateAsync({ tokenPublicKey });
      await rewardsQuery.refetch();
      toast.success("Rewards refreshed");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to refresh rewards"
      );
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleClaim = async () => {
    setIsClaiming(true);
    try {
      const result = await claimMutation.mutateAsync({ tokenPublicKey });
      await rewardsQuery.refetch();
      toast.success(`${formatSol(result.payoutSol)} SOL sent to main wallet`);
      onClaimSuccess();
      refreshMainBalance.mutateAsync({}).catch(() => {});
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to claim rewards"
      );
      rewardsQuery.refetch();
    } finally {
      setIsClaiming(false);
    }
  };

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
                    onClick={handleRefresh}
                    disabled={isRefreshing || isClaiming}
                    aria-label="Refresh creator rewards"
                  >
                    {isRefreshing ? (
                      <IconLoader2 className="size-3.5 animate-spin" />
                    ) : (
                      <IconRefresh className="size-3.5" />
                    )}
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="top" className="text-xs">
                  Refresh rewards
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
              onClick={handleClaim}
              disabled={!hasClaimable || isClaiming || isRefreshing}
            >
              {isClaiming ? (
                <>
                  <IconLoader2 className="mr-1.5 size-3.5 animate-spin" />
                  Claiming...
                </>
              ) : (
                "Claim"
              )}
            </Button>
          </div>
        </div>
      </TooltipProvider>
    </div>
  );
}
