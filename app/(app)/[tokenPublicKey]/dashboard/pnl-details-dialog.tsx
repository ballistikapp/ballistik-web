"use client";

import { IconInfoCircle } from "@tabler/icons-react";
import { formatSol } from "@/lib/utils/format";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface PnlData {
  net: number;
  totalBuyVolume: number;
  totalSellVolume: number;
  platformFees: number;
  proFees: number;
  jitoTipsSol: number;
  totalFees: number;
  creationCostSol: number;
}

interface PnlDetailsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pnl: PnlData;
}

function Row({
  label,
  value,
  valueClass,
  bold,
  tooltip,
}: {
  label: string;
  value: string;
  valueClass?: string;
  bold?: boolean;
  tooltip?: string;
}) {
  return (
    <div
      className={`flex items-center justify-between py-1.5 ${bold ? "font-medium" : ""}`}
    >
      <span className="flex items-center gap-1.5 text-muted-foreground">
        {label}
        {tooltip && (
          <Tooltip>
            <TooltipTrigger asChild>
              <IconInfoCircle className="size-3.5 text-muted-foreground/40" />
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-xs text-xs">
              {tooltip}
            </TooltipContent>
          </Tooltip>
        )}
      </span>
      <span className={`tabular-nums ${valueClass ?? ""}`}>{value}</span>
    </div>
  );
}

function Divider() {
  return <div className="my-1 border-t" />;
}

export function PnlDetailsDialog({
  open,
  onOpenChange,
  pnl,
}: PnlDetailsDialogProps) {
  const tradingPnl = pnl.totalSellVolume - pnl.totalBuyVolume;
  const isTradingProfit = tradingPnl >= 0;
  const isNetProfit = pnl.net >= 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>P&L Details</DialogTitle>
        </DialogHeader>

        <TooltipProvider>
          <div className="flex flex-col gap-4 text-sm">
            <div className="rounded-lg border p-3">
              <Row
                label="Bought (Total Spent)"
                value={`-${formatSol(pnl.totalBuyVolume)} SOL`}
                valueClass="text-red-400"
                tooltip="SOL spent on buying tokens, including the initial dev buy at launch"
              />
              <Row
                label="Sold (Total Received)"
                value={`+${formatSol(pnl.totalSellVolume)} SOL`}
                valueClass="text-green-400"
                tooltip="SOL received from selling tokens on pump.fun"
              />
              <Divider />
              <Row
                label="Trading P&L"
                value={`${isTradingProfit ? "+" : ""}${formatSol(tradingPnl)} SOL`}
                valueClass={isTradingProfit ? "text-green-500" : "text-red-500"}
                bold
                tooltip="Difference between SOL received from sells and SOL spent on buys"
              />
            </div>

            <div className="rounded-lg border p-3">
              <h4 className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Costs
              </h4>
              <Row
                label="Creation Costs"
                value={`-${formatSol(pnl.creationCostSol)} SOL`}
                valueClass="text-red-400"
                tooltip="Token creation overhead including pump.fun creation fee, account rent, and transaction fees"
              />
              <Row
                label="Platform Fees"
                value={`-${formatSol(pnl.platformFees)} SOL`}
                valueClass="text-red-400"
                tooltip="Fees collected by the platform for launch, exit, and volume bot operations"
              />
              <Row
                label="Pro Subscription Fees"
                value={`-${formatSol(pnl.proFees)} SOL`}
                valueClass="text-red-400"
                tooltip="Weekly Pro subscription payments allocated to this token"
              />
              <Row
                label="Jito Tips"
                value={`-${formatSol(pnl.jitoTipsSol)} SOL`}
                valueClass="text-red-400"
                tooltip="Priority tips paid for Jito bundle transactions"
              />
            </div>

            <div className="rounded-lg border p-3">
              <Row
                label="Net P&L"
                value={`${isNetProfit ? "+" : ""}${formatSol(pnl.net)} SOL`}
                valueClass={isNetProfit ? "text-green-500" : "text-red-500"}
                bold
                tooltip="Total realized profit or loss — matches the change in your main wallet balance"
              />
            </div>
          </div>
        </TooltipProvider>
      </DialogContent>
    </Dialog>
  );
}
