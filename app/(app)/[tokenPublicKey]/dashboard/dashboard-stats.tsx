"use client";

import {
  IconWallet,
  IconCoins,
  IconTrendingUp,
  IconTrendingDown,
  IconActivity,
  IconRobot,
} from "@tabler/icons-react";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatSol, formatTokenCount } from "@/lib/utils/format";

interface TreasuryData {
  totalSol: number;
  operationalSol: number;
  devSol: number;
  walletCount: number;
  runningVolumeBots: number;
}

interface HoldingsData {
  valueSol: number;
  tokenCount: number;
}

interface PnlData {
  net: number;
  totalBuyVolume: number;
  totalSellVolume: number;
  holdingsValue: number;
}

interface ActivityData {
  totalVolume: number;
  buyVolume: number;
  sellVolume: number;
  transactionCount: number;
  runningVolumeBots: number;
}

interface DashboardStatsProps {
  metrics: {
    treasury: TreasuryData;
    holdingsValue: HoldingsData;
    pnl: PnlData;
    activity: ActivityData;
  };
}

export function DashboardStats({ metrics }: DashboardStatsProps) {
  const { treasury, holdingsValue, pnl, activity } = metrics;
  const isProfitable = pnl.net >= 0;

  return (
    <div className="grid grid-cols-1 gap-4 @xl/main:grid-cols-2 @5xl/main:grid-cols-4">
      <Card className="@container/card">
        <CardHeader>
          <CardDescription className="flex items-center gap-1.5">
            <IconWallet className="size-4" />
            SOL Treasury
          </CardDescription>
          <CardTitle className="text-2xl font-semibold tabular-nums @[250px]/card:text-3xl">
            {formatSol(treasury.totalSol)} SOL
          </CardTitle>
          <div className="flex flex-col gap-1.5 mt-1">
            <span className="text-xs text-muted-foreground tabular-nums">
              Dev: {formatSol(treasury.devSol)} · Op:{" "}
              {formatSol(treasury.operationalSol)}
            </span>
            <div className="flex gap-1.5 flex-wrap">
              <Badge variant="outline" className="text-muted-foreground text-xs">
                {treasury.walletCount} wallet
                {treasury.walletCount !== 1 ? "s" : ""}
              </Badge>
              {treasury.runningVolumeBots > 0 && (
                <Badge
                  variant="outline"
                  className="text-muted-foreground text-xs"
                >
                  <IconRobot className="size-3" />
                  {treasury.runningVolumeBots} bot
                  {treasury.runningVolumeBots > 1 ? "s" : ""} running
                </Badge>
              )}
            </div>
          </div>
        </CardHeader>
      </Card>

      <Card className="@container/card">
        <CardHeader>
          <CardDescription className="flex items-center gap-1.5">
            <IconCoins className="size-4" />
            Holdings Value
          </CardDescription>
          <CardTitle className="text-2xl font-semibold tabular-nums @[250px]/card:text-3xl">
            {formatSol(holdingsValue.valueSol)} SOL
          </CardTitle>
          <span className="text-xs text-muted-foreground tabular-nums mt-1">
            {formatTokenCount(holdingsValue.tokenCount)} tokens held
          </span>
        </CardHeader>
      </Card>

      <Card className="@container/card">
        <CardHeader>
          <CardDescription className="flex items-center gap-1.5">
            {isProfitable ? (
              <IconTrendingUp className="size-4 text-green-500" />
            ) : (
              <IconTrendingDown className="size-4 text-red-500" />
            )}
            P&L
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
              Spent: {formatSol(pnl.totalBuyVolume)} · Received:{" "}
              {formatSol(pnl.totalSellVolume)}
            </span>
            <span className="text-xs text-muted-foreground tabular-nums">
              Unrealized: {formatSol(pnl.holdingsValue)} SOL
            </span>
          </div>
        </CardHeader>
      </Card>

      <Card className="@container/card">
        <CardHeader>
          <CardDescription className="flex items-center gap-1.5">
            <IconActivity className="size-4" />
            Volume & Activity
          </CardDescription>
          <CardTitle className="text-2xl font-semibold tabular-nums @[250px]/card:text-3xl">
            {formatSol(activity.totalVolume)} SOL
          </CardTitle>
          <div className="flex flex-col gap-1.5 mt-1">
            <span className="text-xs text-muted-foreground tabular-nums">
              Buy: {formatSol(activity.buyVolume)} · Sell:{" "}
              {formatSol(activity.sellVolume)}
            </span>
            <div className="flex gap-1.5 flex-wrap">
              <Badge variant="outline" className="text-muted-foreground text-xs">
                {activity.transactionCount} tx
                {activity.transactionCount !== 1 ? "s" : ""}
              </Badge>
              {activity.runningVolumeBots > 0 && (
                <Badge
                  variant="outline"
                  className="text-muted-foreground text-xs"
                >
                  <IconRobot className="size-3" />
                  {activity.runningVolumeBots} bot
                  {activity.runningVolumeBots > 1 ? "s" : ""}
                </Badge>
              )}
            </div>
          </div>
        </CardHeader>
      </Card>
    </div>
  );
}
