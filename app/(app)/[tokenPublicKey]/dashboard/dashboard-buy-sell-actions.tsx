"use client";

import { IconArrowDown, IconCoins } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface DashboardBuySellActionsProps {
  onOpenBuyDialog: () => void;
  onOpenExitDialog: () => void;
  buyDisabled?: boolean;
  exitDisabled?: boolean;
  /** When false, SELL shows the same tooltip as the holdings page. */
  hasHoldings?: boolean;
  /** Explains why BUY is disabled (e.g. legacy Platform policy). */
  buyDisabledReason?: string | null;
}

export function DashboardBuySellActions({
  onOpenBuyDialog,
  onOpenExitDialog,
  buyDisabled = false,
  exitDisabled = false,
  hasHoldings = true,
  buyDisabledReason = null,
}: DashboardBuySellActionsProps) {
  return (
    <div className="flex h-full w-full min-w-0 flex-col items-stretch justify-center gap-2">
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="block w-full min-w-0">
            <Button
              variant="outline"
              size="lg"
              className="w-full min-w-0 px-4 text-base font-semibold"
              type="button"
              onClick={onOpenBuyDialog}
              disabled={buyDisabled}
            >
              <span className="flex-1 text-center text-primary">BUY</span>
              <IconCoins data-icon="inline-end" className="text-primary" />
            </Button>
          </span>
        </TooltipTrigger>
        {buyDisabled && buyDisabledReason ? (
          <TooltipContent side="left" sideOffset={4}>
            {buyDisabledReason}
          </TooltipContent>
        ) : null}
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="block w-full min-w-0">
            <Button
              variant="outline"
              size="lg"
              className="w-full min-w-0 px-4 text-base font-semibold"
              type="button"
              onClick={onOpenExitDialog}
              disabled={exitDisabled}
            >
              <span className="flex-1 text-center text-destructive">SELL</span>
              <IconArrowDown
                data-icon="inline-end"
                className="text-destructive"
              />
            </Button>
          </span>
        </TooltipTrigger>
        {!hasHoldings ? (
          <TooltipContent side="left" sideOffset={4}>
            No holdings available to sell.
          </TooltipContent>
        ) : null}
      </Tooltip>
    </div>
  );
}
