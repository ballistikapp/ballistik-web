"use client";

import Link from "next/link";
import { IconExternalLink, IconArrowUpRight, IconArrowDownRight, IconSparkles, IconWallet } from "@tabler/icons-react";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface Transaction {
  id: string;
  transactionType: "BUY" | "SELL" | "CREATE";
  status: "PENDING" | "CONFIRMED" | "FAILED";
  solAmount: unknown;
  tokenAmount: unknown;
  pricePerToken: unknown;
  transactionSignature: string;
  createdAt: string | Date;
  wallet: {
    publicKey: string;
    type: string;
  };
}

interface DashboardTransactionsProps {
  transactions: Transaction[];
  tokenPublicKey: string;
}

function truncateAddress(address: string): string {
  return `${address.slice(0, 4)}...${address.slice(-4)}`;
}

function formatTimeAgo(date: string | Date): string {
  const now = new Date();
  const then = new Date(date);
  const diffMs = now.getTime() - then.getTime();
  const diffSecs = Math.floor(diffMs / 1000);
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffSecs < 30) return "just now";
  if (diffMins < 1) return `${diffSecs}s ago`;
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 30) return `${diffDays}d ago`;
  return then.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function formatTokenCount(value: number): string {
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(2)}B`;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return value.toFixed(0);
}

function formatPrice(price: number): string {
  if (price === 0) return "—";
  if (price < 0.000001) return price.toExponential(3);
  if (price < 0.001) return price.toFixed(9);
  return price.toFixed(6);
}

const typeConfig = {
  BUY: {
    icon: IconArrowDownRight,
    color: "text-green-500",
    bg: "bg-green-500/10",
    label: "Buy",
  },
  SELL: {
    icon: IconArrowUpRight,
    color: "text-red-500",
    bg: "bg-red-500/10",
    label: "Sell",
  },
  CREATE: {
    icon: IconSparkles,
    color: "text-blue-500",
    bg: "bg-blue-500/10",
    label: "Create",
  },
} as const;

export function DashboardTransactions({
  transactions,
  tokenPublicKey,
}: DashboardTransactionsProps) {
  if (transactions.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Recent Transactions</CardTitle>
          <CardDescription>Transactions from this token&apos;s wallets</CardDescription>
        </CardHeader>
        <CardContent className="flex items-center justify-center py-8">
          <p className="text-muted-foreground text-sm">No transactions yet</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Recent Transactions</CardTitle>
        <CardDescription>Transactions from this token&apos;s wallets</CardDescription>
      </CardHeader>
      <CardContent className="px-0">
        <div className="divide-y">
          {transactions.map((tx) => {
            const solAmt = Number(tx.solAmount);
            const tokenAmt = Number(tx.tokenAmount);
            const price = Number(tx.pricePerToken);
            const config = typeConfig[tx.transactionType] ?? typeConfig.BUY;
            const Icon = config.icon;

            return (
              <div
                key={tx.id}
                className="flex items-center gap-3 px-6 py-3 hover:bg-muted/30 transition-colors"
              >
                <div
                  className={`flex items-center justify-center size-8 rounded-full shrink-0 ${config.bg}`}
                >
                  <Icon className={`size-4 ${config.color}`} />
                </div>

                <div className="flex flex-col gap-0.5 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className={`text-sm font-medium ${config.color}`}>
                      {config.label}
                    </span>
                    {tx.status === "FAILED" && (
                      <Badge variant="destructive" className="text-[10px] px-1 py-0 leading-tight">
                        FAILED
                      </Badge>
                    )}
                    {tx.status === "PENDING" && (
                      <Badge variant="secondary" className="text-[10px] px-1 py-0 leading-tight">
                        PENDING
                      </Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="font-mono text-xs text-muted-foreground">
                      {truncateAddress(tx.wallet.publicKey)}
                    </span>
                    <Badge variant="outline" className="text-[10px] px-1 py-0 leading-tight">
                      {tx.wallet.type}
                    </Badge>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Link
                          href={`/${tokenPublicKey}/wallets/${tx.wallet.publicKey}`}
                          target="_blank"
                          className="text-muted-foreground hover:text-foreground transition-colors"
                        >
                          <IconWallet className="size-3" />
                        </Link>
                      </TooltipTrigger>
                      <TooltipContent>View wallet</TooltipContent>
                    </Tooltip>
                  </div>
                </div>

                <div className="flex-1" />

                <div className="flex flex-col items-end gap-0.5 shrink-0">
                  <span className="text-sm font-mono tabular-nums">
                    {solAmt.toFixed(4)} SOL
                  </span>
                  {tokenAmt > 0 && (
                    <span className="text-xs font-mono tabular-nums text-muted-foreground">
                      {formatTokenCount(tokenAmt)} tokens
                      {price > 0 && (
                        <span className="hidden @xl/main:inline">
                          {" "}@ {formatPrice(price)}
                        </span>
                      )}
                    </span>
                  )}
                </div>

                <span className="text-xs text-muted-foreground whitespace-nowrap w-14 text-right shrink-0">
                  {formatTimeAgo(tx.createdAt)}
                </span>

                <a
                  href={`https://solscan.io/tx/${tx.transactionSignature}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-muted-foreground hover:text-foreground transition-colors shrink-0"
                >
                  <IconExternalLink className="size-3.5" />
                </a>
              </div>
            );
          })}
        </div>
      </CardContent>
      <CardFooter className="justify-center">
        <Button variant="ghost" size="sm" asChild>
          <Link href={`/${tokenPublicKey}/transactions`}>
            View all transactions
          </Link>
        </Button>
      </CardFooter>
    </Card>
  );
}
