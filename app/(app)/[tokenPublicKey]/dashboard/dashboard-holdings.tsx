"use client";

import Link from "next/link";
import {
  IconExternalLink,
  IconUser,
  IconUsers,
  IconWallet,
} from "@tabler/icons-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface UserWallet {
  publicKey: string;
  type: string;
  tokenBalance: number;
  holdingPercent: number;
  valueSol: number;
  avgBuyPrice: number;
  currentPrice: number;
  unrealizedPnl: number;
  solBalance: number;
}

interface ExternalHolder {
  ownerWallet: string;
  tokenBalance: number;
  holdingPercent: number;
  valueSol: number;
}

interface HoldingsBreakdownData {
  tokenTotalSupply: number;
  bondingCurveTokens: number;
  circulatingSupply: number;
  userTotalTokens: number;
  userOwnershipPercent: number;
  userWallets: UserWallet[];
  externalHolders: ExternalHolder[];
}

interface DashboardHoldingsProps {
  holdings: HoldingsBreakdownData;
  tokenPublicKey: string;
}

function formatTokenCount(value: number): string {
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(2)}B`;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return value.toFixed(0);
}

function formatSol(value: number): string {
  if (Math.abs(value) >= 1_000) return `${(value / 1_000).toFixed(2)}K`;
  if (Math.abs(value) < 0.0001 && value !== 0) return value.toExponential(2);
  return value.toFixed(4);
}

function formatPrice(price: number): string {
  if (price === 0) return "—";
  if (price < 0.000001) return price.toExponential(3);
  if (price < 0.001) return price.toFixed(9);
  if (price < 1) return price.toFixed(6);
  return price.toFixed(4);
}

function truncateAddress(address: string): string {
  return `${address.slice(0, 4)}...${address.slice(-4)}`;
}

export function DashboardHoldings({
  holdings,
  tokenPublicKey,
}: DashboardHoldingsProps) {
  const totalSupply = holdings.tokenTotalSupply || 1;
  const userPct = (holdings.userTotalTokens / totalSupply) * 100;
  const externalTokens = holdings.externalHolders.reduce(
    (sum, h) => sum + h.tokenBalance,
    0
  );
  const externalPct = (externalTokens / totalSupply) * 100;
  const bondingPct = (holdings.bondingCurveTokens / totalSupply) * 100;

  const totalUserValueSol = holdings.userWallets.reduce(
    (sum, w) => sum + w.valueSol,
    0
  );
  const totalUserPnl = holdings.userWallets.reduce(
    (sum, w) => sum + w.unrealizedPnl,
    0
  );

  return (
    <Card>
      <CardHeader className="pb-4">
        <CardTitle>Holdings Breakdown</CardTitle>

        <div className="mt-4 grid grid-cols-2 @xl/main:grid-cols-4 gap-3">
          <SummaryCell
            label="Your Tokens"
            value={formatTokenCount(holdings.userTotalTokens)}
            sub={`${userPct.toFixed(2)}% of supply`}
          />
          <SummaryCell
            label="Your Value"
            value={`${formatSol(totalUserValueSol)} SOL`}
          />
          <SummaryCell
            label="Unrealized P&L"
            value={`${totalUserPnl >= 0 ? "+" : ""}${formatSol(totalUserPnl)} SOL`}
            valueClass={totalUserPnl >= 0 ? "text-green-500" : "text-red-500"}
          />
          <SummaryCell
            label="Total Supply"
            value={formatTokenCount(holdings.tokenTotalSupply)}
            sub={`${formatTokenCount(holdings.circulatingSupply)} circulating`}
          />
        </div>

        <div className="mt-4 space-y-2">
          <div className="flex gap-0.5 h-2.5 rounded-full overflow-hidden bg-muted">
            {userPct > 0 && (
              <div
                className="bg-primary rounded-l-full transition-all"
                style={{ width: `${Math.max(userPct, 0.5)}%` }}
              />
            )}
            {externalPct > 0 && (
              <div
                className="bg-amber-500/60 transition-all"
                style={{ width: `${Math.max(externalPct, 0.5)}%` }}
              />
            )}
            <div
              className="bg-muted-foreground/15 flex-1 rounded-r-full transition-all"
            />
          </div>
          <div className="flex gap-4 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <span className="size-2 rounded-full bg-primary" />
              You ({userPct.toFixed(1)}%)
            </span>
            <span className="flex items-center gap-1.5">
              <span className="size-2 rounded-full bg-amber-500/60" />
              Others ({externalPct.toFixed(1)}%)
            </span>
            <span className="flex items-center gap-1.5">
              <span className="size-2 rounded-full bg-muted-foreground/15" />
              Bonding Curve ({bondingPct.toFixed(1)}%)
            </span>
          </div>
        </div>
      </CardHeader>

      <CardContent className="pt-0 px-0">
        <div className="grid grid-cols-1 @3xl/main:grid-cols-2 gap-0 @3xl/main:gap-4 @3xl/main:px-6">
          <div className="flex flex-col @3xl/main:pr-4">
            <div className="flex items-center gap-1.5 px-6 py-3 @3xl/main:px-0 border-b @3xl/main:border-b-0">
              <IconUser className="size-4 text-muted-foreground" />
              <h3 className="font-semibold text-sm">
                My Wallets ({holdings.userWallets.length})
              </h3>
            </div>
            <div className="max-h-96 overflow-y-auto">
            {holdings.userWallets.length === 0 ? (
              <div className="flex items-center justify-center py-8">
                <p className="text-muted-foreground text-sm">
                  No holdings found
                </p>
              </div>
            ) : (
              <div className="divide-y">
                {holdings.userWallets.map((wallet) => (
                  <div
                    key={wallet.publicKey}
                    className="flex items-center gap-3 px-6 py-3 hover:bg-muted/30 transition-colors"
                  >
                    <div className="flex flex-col gap-0.5 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono text-xs text-muted-foreground">
                          {truncateAddress(wallet.publicKey)}
                        </span>
                        <Badge
                          variant="outline"
                          className="text-[10px] px-1 py-0 leading-tight"
                        >
                          {wallet.type}
                        </Badge>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Link
                              href={`/${tokenPublicKey}/wallets/${wallet.publicKey}`}
                              target="_blank"
                              className="text-muted-foreground hover:text-foreground transition-colors"
                            >
                              <IconWallet className="size-3" />
                            </Link>
                          </TooltipTrigger>
                          <TooltipContent>View wallet</TooltipContent>
                        </Tooltip>
                        <a
                          href={`https://solscan.io/account/${wallet.publicKey}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-muted-foreground hover:text-foreground transition-colors"
                        >
                          <IconExternalLink className="size-3" />
                        </a>
                      </div>
                      <div className="flex items-center gap-3 text-xs text-muted-foreground">
                        <span className="font-mono tabular-nums">
                          Avg {formatPrice(wallet.avgBuyPrice)}
                        </span>
                        <span className="font-mono tabular-nums">
                          SOL Bal: {formatSol(wallet.solBalance)}
                        </span>
                      </div>
                    </div>

                    <div className="flex-1" />

                    <div className="flex flex-col items-end gap-0.5 shrink-0">
                      <span className="text-sm font-mono tabular-nums">
                        {formatTokenCount(wallet.tokenBalance)}
                      </span>
                      <span className="text-xs font-mono tabular-nums text-muted-foreground">
                        {formatSol(wallet.valueSol)} SOL
                      </span>
                    </div>

                    <div className="flex flex-col items-end gap-0.5 shrink-0 w-16">
                      <span className="text-sm font-mono tabular-nums">
                        {wallet.holdingPercent.toFixed(2)}%
                      </span>
                      <div className="w-full h-1 rounded-full bg-muted overflow-hidden">
                        <div
                          className="h-full rounded-full bg-primary transition-all"
                          style={{
                            width: `${Math.min(wallet.holdingPercent, 100)}%`,
                          }}
                        />
                      </div>
                    </div>

                    <div className="flex flex-col items-end shrink-0 w-24">
                      <span
                        className={`text-sm font-mono tabular-nums ${
                          wallet.unrealizedPnl >= 0
                            ? "text-green-500"
                            : "text-red-500"
                        }`}
                      >
                        {wallet.unrealizedPnl >= 0 ? "+" : ""}
                        {formatSol(wallet.unrealizedPnl)}
                      </span>
                      <span className="text-[10px] text-muted-foreground">
                        P&L
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
            </div>
          </div>

          <div className="flex flex-col @3xl/main:border-l @3xl/main:pl-4">
            <div className="flex items-center gap-1.5 px-6 py-3 @3xl/main:px-0 border-b @3xl/main:border-b-0">
              <IconUsers className="size-4 text-muted-foreground" />
              <h3 className="font-semibold text-sm">
                External Holders ({holdings.externalHolders.length})
              </h3>
            </div>
            <div className="max-h-96 overflow-y-auto">
            {holdings.externalHolders.length === 0 ? (
              <div className="flex items-center justify-center py-8">
                <p className="text-muted-foreground text-sm">
                  No external holders found
                </p>
              </div>
            ) : (
              <div className="divide-y">
                {holdings.externalHolders.map((holder) => (
                  <div
                    key={holder.ownerWallet}
                    className="flex items-center gap-3 px-6 py-3 hover:bg-muted/30 transition-colors"
                  >
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="font-mono text-xs text-muted-foreground">
                        {truncateAddress(holder.ownerWallet)}
                      </span>
                      <a
                        href={`https://solscan.io/account/${holder.ownerWallet}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-muted-foreground hover:text-foreground transition-colors"
                      >
                        <IconExternalLink className="size-3" />
                      </a>
                    </div>

                    <div className="flex-1" />

                    <div className="flex flex-col items-end gap-0.5 shrink-0">
                      <span className="text-sm font-mono tabular-nums">
                        {formatTokenCount(holder.tokenBalance)}
                      </span>
                      <span className="text-xs font-mono tabular-nums text-muted-foreground">
                        {formatSol(holder.valueSol)} SOL
                      </span>
                    </div>

                    <div className="flex flex-col items-end gap-0.5 shrink-0 w-16">
                      <span className="text-sm font-mono tabular-nums">
                        {holder.holdingPercent.toFixed(2)}%
                      </span>
                      <div className="w-full h-1 rounded-full bg-muted overflow-hidden">
                        <div
                          className="h-full rounded-full bg-amber-500/60 transition-all"
                          style={{
                            width: `${Math.min(holder.holdingPercent, 100)}%`,
                          }}
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function SummaryCell({
  label,
  value,
  sub,
  valueClass,
}: {
  label: string;
  value: string;
  sub?: string;
  valueClass?: string;
}) {
  return (
    <div className="rounded-lg border bg-muted/30 px-3 py-2">
      <p className="text-[11px] text-muted-foreground uppercase tracking-wider">
        {label}
      </p>
      <p
        className={`text-sm font-mono font-semibold tabular-nums mt-0.5 ${valueClass ?? ""}`}
      >
        {value}
      </p>
      {sub && (
        <p className="text-[11px] text-muted-foreground font-mono tabular-nums">
          {sub}
        </p>
      )}
    </div>
  );
}
