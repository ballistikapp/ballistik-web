"use client";

import { IconInfoCircle } from "@tabler/icons-react";
import { formatSol } from "@/lib/utils/format";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface LaunchFeeBreakdown {
  generatedWalletFeeSol: number;
  generatedWalletCount: number;
  vanityMintFeeSol: number;
  attributionRemovalFeeSol: number;
  bundleBuyFeeSol: number;
}

interface PnlData {
  net: number;
  totalBuyVolume: number;
  totalSellVolume: number;
  creatorRewardsClaimedSol: number;
  platformFees: number;
  launchFees: number;
  launchFeeBreakdown: LaunchFeeBreakdown | null;
  exitFees: number;
  volumeBotFees: number;
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
  indent,
}: {
  label: string;
  value: string;
  valueClass?: string;
  bold?: boolean;
  tooltip?: string;
  indent?: boolean;
}) {
  return (
    <div
      className={`flex items-center justify-between py-1.5 ${bold ? "font-medium" : ""} ${indent ? "pl-4" : ""}`}
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

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <h4 className="mb-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
      {children}
    </h4>
  );
}

function Divider() {
  return <div className="my-1 border-t" />;
}

function costClass(v: number) {
  return v > 0 ? "text-red-400" : "text-muted-foreground";
}

interface CostItem {
  label: string;
  value: number;
  tooltip: string;
  children?: CostItem[];
}

function buildLaunchFeeChildren(bd: LaunchFeeBreakdown): CostItem[] {
  const items: CostItem[] = [];
  if (bd.generatedWalletFeeSol > 0) {
    items.push({
      label: `Generated Wallets (${bd.generatedWalletCount})`,
      value: bd.generatedWalletFeeSol,
      tooltip: `Fee for generating ${bd.generatedWalletCount} operational wallets`,
    });
  }
  if (bd.vanityMintFeeSol > 0) {
    items.push({
      label: "Vanity Mint",
      value: bd.vanityMintFeeSol,
      tooltip: "Fee for generating a vanity token mint address",
    });
  }
  if (bd.attributionRemovalFeeSol > 0) {
    items.push({
      label: "Attribution Removal",
      value: bd.attributionRemovalFeeSol,
      tooltip: "Fee for removing platform attribution from token description",
    });
  }
  if (bd.bundleBuyFeeSol > 0) {
    items.push({
      label: "Bundler",
      value: bd.bundleBuyFeeSol,
      tooltip: "Fee for bundled buy with multiple wallets at launch",
    });
  }
  return items;
}

export function PnlDetailsDialog({
  open,
  onOpenChange,
  pnl,
}: PnlDetailsDialogProps) {
  const totalSpent =
    pnl.totalBuyVolume +
    pnl.creationCostSol +
    pnl.platformFees +
    pnl.jitoTipsSol;
  const totalReceived = pnl.totalSellVolume + pnl.creatorRewardsClaimedSol;
  const isNetProfit = pnl.net >= 0;

  const launchFeeChildren =
    pnl.launchFeeBreakdown && pnl.launchFees > 0
      ? buildLaunchFeeChildren(pnl.launchFeeBreakdown)
      : [];

  const costItems: CostItem[] = [
    {
      label: "Token Buys",
      value: pnl.totalBuyVolume,
      tooltip:
        "SOL spent buying tokens across this token's managed wallets, including the initial dev buy at launch",
    },
    {
      label: "Creation Costs",
      value: pnl.creationCostSol,
      tooltip: "Token creation overhead including pump.fun creation fee, account rent, and transaction fees",
    },
    {
      label: "Launch Fees",
      value: pnl.launchFees,
      tooltip: "Platform fees charged for token launch",
      children: launchFeeChildren,
    },
    {
      label: "Exit Fees",
      value: pnl.exitFees,
      tooltip: "Platform fees charged for token exit operations",
    },
    {
      label: "Volume Bot Fees",
      value: pnl.volumeBotFees,
      tooltip: "Platform fees charged for volume bot sessions",
    },
    {
      label: "Jito Tips",
      value: pnl.jitoTipsSol,
      tooltip: "Priority tips paid for Jito bundle transactions",
    },
  ].filter((item) => item.value > 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>P&L Details</DialogTitle>
          <DialogDescription>
            Realized portfolio P&amp;L across this token&apos;s managed wallets.
          </DialogDescription>
        </DialogHeader>

        <TooltipProvider>
          <div className="flex flex-col gap-4 text-sm">
            <div className="rounded-lg border p-3">
              <SectionHeader>Total Spent</SectionHeader>
              {costItems.map((item) => (
                <div key={item.label}>
                  <Row
                    label={item.label}
                    value={`-${formatSol(item.value)} SOL`}
                    valueClass={costClass(item.value)}
                    tooltip={item.tooltip}
                  />
                  {item.children?.map((sub) => (
                    <Row
                      key={sub.label}
                      label={sub.label}
                      value={`-${formatSol(sub.value)} SOL`}
                      valueClass={costClass(sub.value)}
                      tooltip={sub.tooltip}
                      indent
                    />
                  ))}
                </div>
              ))}
              <Divider />
              <Row
                label="Total"
                value={`-${formatSol(totalSpent)} SOL`}
                valueClass={costClass(totalSpent)}
                bold
              />
            </div>

            <div className="rounded-lg border p-3">
              <SectionHeader>Total Received</SectionHeader>
              <Row
                label="Token Sales"
                value={`+${formatSol(pnl.totalSellVolume)} SOL`}
                valueClass={pnl.totalSellVolume > 0 ? "text-green-400" : "text-muted-foreground"}
                tooltip="SOL received by this token's managed wallets from selling tokens on pump.fun, whether or not it has already been returned to the main wallet"
              />
              {pnl.creatorRewardsClaimedSol > 0 && (
                <Row
                  label="Creator Rewards"
                  value={`+${formatSol(pnl.creatorRewardsClaimedSol)} SOL`}
                  valueClass="text-green-400"
                  tooltip="Claimed creator rewards from pump.fun trading fees"
                />
              )}
              <Divider />
              <Row
                label="Total"
                value={`+${formatSol(totalReceived)} SOL`}
                valueClass={totalReceived > 0 ? "text-green-400" : "text-muted-foreground"}
                bold
              />
            </div>

            <div className="rounded-lg border p-3">
              <Row
                label="Net P&L"
                value={`${isNetProfit ? "+" : ""}${formatSol(pnl.net)} SOL`}
                valueClass={pnl.net !== 0 ? (isNetProfit ? "text-green-500" : "text-red-500") : "text-muted-foreground"}
                bold
                tooltip="Total realized profit or loss across this token's managed wallets, including claimed creator rewards. This does not require the proceeds to have already been returned to the main wallet."
              />
            </div>
          </div>
        </TooltipProvider>
      </DialogContent>
    </Dialog>
  );
}
