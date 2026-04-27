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
  /** Present for launches after generated-wallet fee change; else use generatedWalletCount. */
  generatedWalletsBilledForFeeCount?: number;
  nonSystemDevWalletFeeSol: number;
  vanityMintFeeSol: number;
  attributionRemovalFeeSol: number;
  bundleBuyFeeSol: number;
}

interface PnlData {
  net: number;
  tokenBuys: number;
  tokenSells: number;
  tokenCreates: number;
  platformFees: number;
  launchFees: number;
  exitFees: number;
  volumeBotFees: number;
  walletFees: number;
  launchFeeBreakdown: LaunchFeeBreakdown | null;
  jitoTips: number;
  transfers: number;
  ataOps: number;
  tokenOps: number;
  creatorRewards: number;
  rewardsClaim: number;
  rewardsPayout: number;
  unsettledRowCount: number;
  isComplete: boolean;
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

// Signed-delta formatter:
//   negative → "-X.XX SOL" in red (an outflow / cost)
//   positive → "+X.XX SOL" in green (an inflow / revenue)
//   zero     → "0 SOL" muted
function formatDelta(value: number): { text: string; className: string } {
  if (value > 0) {
    return {
      text: `+${formatSol(Math.abs(value))} SOL`,
      className: "text-green-400",
    };
  }
  if (value < 0) {
    return {
      text: `-${formatSol(Math.abs(value))} SOL`,
      className: "text-red-400",
    };
  }
  return { text: `${formatSol(0)} SOL`, className: "text-muted-foreground" };
}

interface DeltaItem {
  label: string;
  value: number;
  tooltip: string;
  children?: DeltaItem[];
}

function buildLaunchFeeChildren(
  bd: LaunchFeeBreakdown,
  totalLaunchFee: number
): DeltaItem[] {
  // Launch fee breakdown lines are sourced from launch input config (intent),
  // not from row deltas, so they're displayed as negative outflows.
  const items: DeltaItem[] = [];
  if (bd.generatedWalletFeeSol > 0) {
    const billed =
      bd.generatedWalletsBilledForFeeCount ?? bd.generatedWalletCount;
    items.push({
      label: `Generated Wallets (${billed})`,
      value: -bd.generatedWalletFeeSol,
      tooltip: `Fee for ${billed} generated operational wallets`,
    });
  }
  if ((bd.nonSystemDevWalletFeeSol ?? 0) > 0) {
    items.push({
      label: "Custom dev wallet",
      value: -bd.nonSystemDevWalletFeeSol,
      tooltip:
        "Legacy launch usage line item (no longer charged for new launches)",
    });
  }
  if (bd.vanityMintFeeSol > 0) {
    items.push({
      label: "Vanity Mint",
      value: -bd.vanityMintFeeSol,
      tooltip: "Fee for generating a vanity token mint address",
    });
  }
  if (bd.attributionRemovalFeeSol > 0) {
    items.push({
      label: "Attribution Removal",
      value: -bd.attributionRemovalFeeSol,
      tooltip: "Fee for removing platform attribution from token description",
    });
  }
  if (bd.bundleBuyFeeSol > 0) {
    items.push({
      label: "Bundler",
      value: -bd.bundleBuyFeeSol,
      tooltip: "Fee for bundled buy with multiple wallets at launch",
    });
  }
  // The breakdown sums to "intent". Reconcile any difference vs the actual
  // tracked launch fee delta into a residual line so the parent total adds up.
  const intentSum = items.reduce((s, it) => s + it.value, 0);
  const residual = totalLaunchFee - intentSum;
  if (Math.abs(residual) > 0.0001) {
    items.push({
      label: "Tx fees (collection)",
      value: residual,
      tooltip:
        "On-chain transaction fees for the platform fee collection itself",
    });
  }
  return items;
}

export function PnlDetailsDialog({
  open,
  onOpenChange,
  pnl,
}: PnlDetailsDialogProps) {
  const isNetProfit = pnl.net >= 0;

  const launchFeeChildren =
    pnl.launchFeeBreakdown && pnl.launchFees < 0
      ? buildLaunchFeeChildren(pnl.launchFeeBreakdown, pnl.launchFees)
      : [];

  // All deltas are signed. Sections group by economic meaning so the user can
  // see what flowed in vs out of their wallets.
  const tradesItems: DeltaItem[] = [
    {
      label: "Buy Transaction Cost",
      value: pnl.tokenBuys,
      tooltip:
        "Total SOL decrease from buy/create transactions, including buy principal, pump.fun/on-chain fees, account rent, and transaction fees.",
    },
    {
      label: "Sell Proceeds",
      value: pnl.tokenSells,
      tooltip:
        "Total SOL increase from sell transactions, after on-chain fees.",
    },
    {
      label: "Token Creation Cost",
      value: pnl.tokenCreates,
      tooltip:
        "SOL decrease for token creation transactions where a buy did not share the same transaction.",
    },
  ].filter((item) => item.value !== 0);

  const platformFeesItem: DeltaItem = {
    label: "Platform Fees",
    value: pnl.platformFees,
    tooltip: "All sollabs platform usage fees, broken down by source",
    children:
      pnl.launchFees < 0 || launchFeeChildren.length > 0
        ? [
            {
              label: "Launch",
              value: pnl.launchFees,
              tooltip:
                "Fees charged at token launch (broken down further below)",
              children: launchFeeChildren,
            },
            ...(pnl.exitFees < 0
              ? [
                  {
                    label: "Exit",
                    value: pnl.exitFees,
                    tooltip: "Fees charged for batch holding exit operations",
                  },
                ]
              : []),
            ...(pnl.volumeBotFees < 0
              ? [
                  {
                    label: "Volume Bot",
                    value: pnl.volumeBotFees,
                    tooltip: "Fees charged for volume bot sessions",
                  },
                ]
              : []),
            ...(pnl.walletFees < 0
              ? [
                  {
                    label: "Wallets",
                    value: pnl.walletFees,
                    tooltip: "Fees charged for token-scoped wallet creation",
                  },
                ]
              : []),
          ]
        : [
            ...(pnl.exitFees < 0
              ? [
                  {
                    label: "Exit",
                    value: pnl.exitFees,
                    tooltip: "Fees charged for batch holding exit operations",
                  },
                ]
              : []),
            ...(pnl.volumeBotFees < 0
              ? [
                  {
                    label: "Volume Bot",
                    value: pnl.volumeBotFees,
                    tooltip: "Fees charged for volume bot sessions",
                  },
                ]
              : []),
            ...(pnl.walletFees < 0
              ? [
                  {
                    label: "Wallets",
                    value: pnl.walletFees,
                    tooltip: "Fees charged for token-scoped wallet creation",
                  },
                ]
              : []),
          ],
  };

  const costItems: DeltaItem[] = [
    ...(pnl.platformFees !== 0 ? [platformFeesItem] : []),
    {
      label: "Jito Tips",
      value: pnl.jitoTips,
      tooltip: "Priority tips paid for Jito bundle transactions",
    },
    {
      label: "Internal Movement",
      value: pnl.transfers,
      tooltip:
        "Net SOL change for internal transfers between your wallets (typically just the on-chain transaction fee leakage)",
    },
    {
      label: "ATA Operations",
      value: pnl.ataOps,
      tooltip: "Token account create/close rent + fees",
    },
    {
      label: "Token Operations",
      value: pnl.tokenOps,
      tooltip: "Token distribution / consolidation transaction fees",
    },
  ].filter((item) => item.value !== 0);

  const rewardsItems: DeltaItem[] = [
    {
      label: "Creator Rewards",
      value: pnl.creatorRewards,
      tooltip:
        "Net SOL change from claim + payout of pump.fun creator rewards (claimed from vault, minus on-chain fees).",
    },
  ].filter((item) => item.value !== 0);

  const renderItems = (items: DeltaItem[]) =>
    items.map((item) => {
      const fmt = formatDelta(item.value);
      return (
        <div key={item.label}>
          <Row
            label={item.label}
            value={fmt.text}
            valueClass={fmt.className}
            tooltip={item.tooltip}
          />
          {item.children?.map((sub) => {
            const subFmt = formatDelta(sub.value);
            return (
              <div key={sub.label}>
                <Row
                  label={sub.label}
                  value={subFmt.text}
                  valueClass={subFmt.className}
                  tooltip={sub.tooltip}
                  indent
                />
                {sub.children?.map((sub2) => {
                  const sub2Fmt = formatDelta(sub2.value);
                  return (
                    <div key={sub2.label} className="pl-4">
                      <Row
                        label={sub2.label}
                        value={sub2Fmt.text}
                        valueClass={sub2Fmt.className}
                        tooltip={sub2.tooltip}
                        indent
                      />
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      );
    });

  const netFmt = formatDelta(pnl.net);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Realized SOL P&amp;L Details</DialogTitle>
          <DialogDescription>
            Confirmed SOL inflows and outflows across this token&apos;s managed
            wallets.
          </DialogDescription>
        </DialogHeader>

        <TooltipProvider>
          <div className="flex flex-col gap-4 text-sm">
            {!pnl.isComplete && (
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-600 dark:text-amber-400">
                {pnl.unsettledRowCount} confirmed transaction
                {pnl.unsettledRowCount === 1 ? "" : "s"} not yet settled. Refresh
                shortly for the final number.
              </div>
            )}

            {tradesItems.length > 0 && (
              <div className="rounded-lg border p-3">
                <SectionHeader>Trading Cashflow</SectionHeader>
                {renderItems(tradesItems)}
              </div>
            )}

            {costItems.length > 0 && (
              <div className="rounded-lg border p-3">
                <SectionHeader>Operational Costs</SectionHeader>
                {renderItems(costItems)}
              </div>
            )}

            {rewardsItems.length > 0 && (
              <div className="rounded-lg border p-3">
                <SectionHeader>Rewards</SectionHeader>
                {renderItems(rewardsItems)}
              </div>
            )}

            <div className="rounded-lg border p-3">
              <Row
                label="Net Realized SOL P&L"
                value={netFmt.text}
                valueClass={
                  pnl.net !== 0
                    ? isNetProfit
                      ? "text-green-500"
                      : "text-red-500"
                    : "text-muted-foreground"
                }
                bold
                tooltip="Sum of confirmed signed SOL wallet deltas for this token across managed wallets."
              />
            </div>
            <Divider />
          </div>
        </TooltipProvider>
      </DialogContent>
    </Dialog>
  );
}
