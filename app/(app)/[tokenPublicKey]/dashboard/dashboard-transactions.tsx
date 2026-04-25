"use client";

import Image from "next/image";
import Link from "next/link";
import { IconExternalLink, IconArrowUpRight, IconArrowDownRight, IconSparkles } from "@tabler/icons-react";
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
import {
  truncateAddress,
  formatTimeAgo,
  formatTokenCount,
  formatPrice,
} from "@/lib/utils/format";

interface DashboardTransaction {
  id: string;
  transactionType: "BUY" | "SELL" | "CREATE";
  status: "PENDING" | "CONFIRMED" | "FAILED";
  solAmount: number | string;
  tokenAmount: number | string;
  pricePerToken: number | string;
  transactionSignature: string;
  blockTime: string | Date | null;
  createdAt: string | Date;
  walletPublicKey: string;
  walletType: string | null;
  isOwned: boolean;
}

interface DashboardTransactionsProps {
  transactions: DashboardTransaction[];
  tokenPublicKey: string;
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
  const transactionsHref = `/${tokenPublicKey}/transactions`;

  if (transactions.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Recent Transactions</CardTitle>
          <CardDescription>Token buy/sell activity</CardDescription>
        </CardHeader>
        <CardContent className="flex items-center justify-center py-8">
          <p className="text-muted-foreground text-sm">No transactions yet</p>
        </CardContent>
        <CardFooter className="justify-end">
          <Link
            href={transactionsHref}
            className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground hover:underline"
          >
            Transactions
            <IconExternalLink className="size-3.5" />
          </Link>
        </CardFooter>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Recent Transactions</CardTitle>
        <CardDescription>Token buy/sell activity</CardDescription>
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
                    {!tx.isOwned && (
                      <Badge variant="secondary" className="text-[10px] px-1 py-0 leading-tight">
                        EXT
                      </Badge>
                    )}
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
                    <Tooltip>
                      <TooltipTrigger asChild>
                        {tx.isOwned ? (
                          <Link
                            href={`/${tokenPublicKey}/wallets/${tx.walletPublicKey}`}
                            target="_blank"
                            className="font-mono text-xs text-muted-foreground hover:text-foreground hover:underline transition-colors"
                          >
                            {truncateAddress(tx.walletPublicKey)}
                          </Link>
                        ) : (
                          <a
                            href={`https://solscan.io/account/${tx.walletPublicKey}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="font-mono text-xs text-muted-foreground hover:text-foreground hover:underline transition-colors"
                          >
                            {truncateAddress(tx.walletPublicKey)}
                          </a>
                        )}
                      </TooltipTrigger>
                      <TooltipContent className="flex items-center gap-1">
                        {tx.isOwned ? "Go to Wallet" : "View Wallet on Solscan"}
                        <IconExternalLink className="size-3" />
                      </TooltipContent>
                    </Tooltip>
                    {tx.walletType && (
                      <Badge variant="outline" className="text-[10px] px-1 py-0 leading-tight">
                        {tx.walletType}
                      </Badge>
                    )}
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
                  {formatTimeAgo(tx.blockTime ?? tx.createdAt)}
                </span>

                <Tooltip>
                  <TooltipTrigger asChild>
                    <a
                      href={`https://solscan.io/tx/${tx.transactionSignature}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-muted-foreground hover:text-foreground transition-colors shrink-0"
                    >
                      <Image
                        src="/logos/solscan-logo-dark.svg"
                        alt="Solscan"
                        width={14}
                        height={14}
                        className="size-3.5"
                      />
                    </a>
                  </TooltipTrigger>
                  <TooltipContent>View Transaction on Solscan</TooltipContent>
                </Tooltip>
              </div>
            );
          })}
        </div>
      </CardContent>
      <CardFooter className="justify-end">
        <Link
          href={transactionsHref}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground hover:underline"
        >
          Transactions
          <IconExternalLink className="size-3.5" />
        </Link>
      </CardFooter>
    </Card>
  );
}
