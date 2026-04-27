"use client";

import { useState } from "react";
import Link from "next/link";
import {
  IconChartBar,
  IconCoins,
  IconExternalLink,
  IconTrendingUp,
  IconTrendingDown,
  IconActivity,
  IconInfoCircle,
} from "@tabler/icons-react";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  formatMarketCap,
  formatPriceSol,
  formatSol,
  formatTokenCount,
  formatUsd,
} from "@/lib/utils/format";
import { PnlDetailsDialog } from "./pnl-details-dialog";

interface HoldingsData {
  valueSol: number;
  tokenCount: number;
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
  launchFeeBreakdown: {
    generatedWalletFeeSol: number;
    generatedWalletCount: number;
    generatedWalletsBilledForFeeCount?: number;
    nonSystemDevWalletFeeSol: number;
    vanityMintFeeSol: number;
    attributionRemovalFeeSol: number;
    bundleBuyFeeSol: number;
  } | null;
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

interface ActivityData {
  totalVolume: number;
  buyVolume: number;
  sellVolume: number;
  transactionCount: number;
}

interface HeaderData {
  priceSol: number;
  marketCapSol: number;
  marketCapUsd: number;
}

interface DashboardStatsProps {
  header: HeaderData;
  tokenPublicKey: string;
  metrics: {
    holdingsValue: HoldingsData;
    pnl: PnlData;
    activity: ActivityData;
  };
}

export function DashboardStats({
  header,
  tokenPublicKey,
  metrics,
}: DashboardStatsProps) {
  const { holdingsValue, pnl, activity } = metrics;
  const isProfitable = pnl.net >= 0;
  const pnlIncomplete = !pnl.isComplete;
  // Inflows = positive deltas; outflows = negative deltas. We split the signed
  // numbers back into "spent" / "received" purely for the card subtitle.
  const totalSpent =
    -Math.min(0, pnl.tokenBuys) +
    -Math.min(0, pnl.tokenCreates) +
    -Math.min(0, pnl.platformFees) +
    -Math.min(0, pnl.jitoTips) +
    -Math.min(0, pnl.transfers) +
    -Math.min(0, pnl.ataOps) +
    -Math.min(0, pnl.tokenOps) +
    -Math.min(0, pnl.creatorRewards);
  const totalReceived =
    Math.max(0, pnl.tokenSells) +
    Math.max(0, pnl.tokenCreates) +
    Math.max(0, pnl.creatorRewards) +
    Math.max(0, pnl.transfers) +
    Math.max(0, pnl.ataOps) +
    Math.max(0, pnl.tokenOps);
  const [pnlDialogOpen, setPnlDialogOpen] = useState(false);
  const transactionsHref = `/${tokenPublicKey}/transactions`;
  const holdingsHref = `/${tokenPublicKey}/holdings`;

  return (
    <div className="grid grid-cols-1 gap-4 @xl/main:grid-cols-2 @5xl/main:grid-cols-4">
      <Card className="@container/card">
        <CardHeader>
          <CardDescription className="flex items-center gap-1.5">
            <IconChartBar className="size-4" />
            Market Cap
          </CardDescription>
          <CardTitle className="text-2xl font-semibold tabular-nums @[250px]/card:text-3xl">
            {header.marketCapUsd > 0
              ? formatUsd(header.marketCapUsd)
              : `${formatMarketCap(header.marketCapSol)} SOL`}
          </CardTitle>
          <div className="flex flex-col gap-1 mt-1">
            <span className="text-xs text-muted-foreground tabular-nums">
              Price: {formatPriceSol(header.priceSol)} SOL
            </span>
          </div>
        </CardHeader>
      </Card>

      <Card className="@container/card">
        <CardHeader className="h-full">
          <CardDescription className="flex items-center gap-1.5">
            <IconActivity className="size-4" />
            Volume & Activity
          </CardDescription>
          <CardTitle className="text-2xl font-semibold tabular-nums @[250px]/card:text-3xl">
            {formatSol(activity.totalVolume)} SOL
          </CardTitle>
          <div className="flex flex-1 flex-col justify-between gap-1.5 mt-1">
            <span className="text-xs text-muted-foreground tabular-nums">
              Buy: {formatSol(activity.buyVolume)} · Sell:{" "}
              {formatSol(activity.sellVolume)}
            </span>
            <div className="flex items-center gap-1.5">
              <Badge
                variant="outline"
                className="text-muted-foreground text-xs"
              >
                {activity.transactionCount} tx
                {activity.transactionCount !== 1 ? "s" : ""}
              </Badge>
              <div className="flex-1" />
              <Link
                href={transactionsHref}
                className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground hover:underline"
              >
                Transactions
                <IconExternalLink className="size-3.5" />
              </Link>
            </div>
          </div>
        </CardHeader>
      </Card>

      <Card
        className="group @container/card cursor-pointer transition-colors hover:bg-muted/50"
        onClick={() => setPnlDialogOpen(true)}
      >
        <CardHeader>
          <CardDescription className="flex items-center gap-1.5">
            {isProfitable ? (
              <IconTrendingUp className="size-4 text-green-500" />
            ) : (
              <IconTrendingDown className="size-4 text-red-500" />
            )}
            Realized P&amp;L
          </CardDescription>
          <CardTitle
            className={`text-2xl font-semibold tabular-nums @[250px]/card:text-3xl ${
              isProfitable ? "text-green-500" : "text-red-500"
            }`}
          >
            {isProfitable ? "+" : ""}
            {formatSol(pnl.net)} SOL
          </CardTitle>
          <div className="flex flex-col gap-1 mt-1">
            <span className="text-xs text-muted-foreground tabular-nums">
              Outflow: {formatSol(totalSpent)} · Inflow:{" "}
              {formatSol(totalReceived)}
            </span>
            {pnlIncomplete && (
              <span className="text-xs text-amber-500">
                {pnl.unsettledRowCount} unsettled tx
                {pnl.unsettledRowCount === 1 ? "" : "s"}
              </span>
            )}
            <div className="flex items-center justify-end gap-1.5 mt-1">
              <span className="text-xs text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100">
                Click for details
              </span>
              <IconInfoCircle className="size-3.5 text-muted-foreground/40 transition-colors group-hover:text-muted-foreground" />
            </div>
          </div>
        </CardHeader>
      </Card>

      <PnlDetailsDialog
        open={pnlDialogOpen}
        onOpenChange={setPnlDialogOpen}
        pnl={pnl}
      />

      <Card className="@container/card">
        <CardHeader className="h-full">
          <CardDescription className="flex items-center gap-1.5">
            <IconCoins className="size-4" />
            Holdings Value
          </CardDescription>
          <CardTitle className="text-2xl font-semibold tabular-nums @[250px]/card:text-3xl">
            {formatSol(holdingsValue.valueSol)} SOL
          </CardTitle>
          <div className="flex flex-1 flex-col justify-between gap-1 mt-1">
            <span className="text-xs text-muted-foreground tabular-nums">
              {formatTokenCount(holdingsValue.tokenCount)} tokens held
            </span>
            <div className="flex justify-end">
              <Link
                href={holdingsHref}
                className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground hover:underline"
              >
                Holdings
                <IconExternalLink className="size-3.5" />
              </Link>
            </div>
          </div>
        </CardHeader>
      </Card>
    </div>
  );
}
