"use client";

import Image from "next/image";
import { IconPool } from "@tabler/icons-react";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface PoolToken {
  address: string;
  symbol: string;
  name: string;
  reserve: number;
  decimals: number;
}

interface Pool {
  address: string;
  dex: string;
  tvlUsd: number;
  volume24hUsd: number;
  feeRate: number;
  tokenA: PoolToken;
  tokenB: PoolToken;
  createdAt: string;
}

interface DashboardDefiPoolsProps {
  pools: Pool[];
}

function formatUsd(value: number) {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(2)}K`;
  return `$${value.toFixed(2)}`;
}

function formatReserve(value: number) {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(2)}K`;
  return value.toFixed(2);
}

function shortenAddress(address: string) {
  return `${address.slice(0, 4)}...${address.slice(-4)}`;
}

function explorerUrl(address: string) {
  return `https://solscan.io/account/${address}`;
}

export function DashboardDefiPools({ pools }: DashboardDefiPoolsProps) {
  if (pools.length === 0) return null;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <IconPool className="h-5 w-5 text-muted-foreground" />
        <h3 className="text-sm font-medium">DeFi Pools</h3>
        <Badge variant="secondary" className="text-xs">
          {pools.length}
        </Badge>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {pools.map((pool) => (
          <div
            key={pool.address}
            className="rounded-lg border bg-card p-4 space-y-3"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="text-xs">
                  {pool.dex}
                </Badge>
                <span className="text-xs font-medium text-muted-foreground">
                  {pool.tokenA.symbol}/{pool.tokenB.symbol}
                </span>
              </div>
              <Tooltip>
                <TooltipTrigger asChild>
                  <a
                    href={explorerUrl(pool.address)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <Image
                      src="/logos/solscan-logo-dark.svg"
                      alt="Solscan"
                      width={16}
                      height={16}
                      className="h-4 w-4"
                    />
                  </a>
                </TooltipTrigger>
                <TooltipContent>
                  <p>{shortenAddress(pool.address)}</p>
                </TooltipContent>
              </Tooltip>
            </div>

            <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              <div>
                <p className="text-xs text-muted-foreground">TVL</p>
                <p className="font-medium">{formatUsd(pool.tvlUsd)}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">24h Volume</p>
                <p className="font-medium">{formatUsd(pool.volume24hUsd)}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">
                  {pool.tokenA.symbol}
                </p>
                <p className="font-mono text-xs">
                  {formatReserve(pool.tokenA.reserve)}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">
                  {pool.tokenB.symbol}
                </p>
                <p className="font-mono text-xs">
                  {formatReserve(pool.tokenB.reserve)}
                </p>
              </div>
            </div>

            {pool.feeRate > 0 && (
              <p className="text-xs text-muted-foreground">
                Fee: {(pool.feeRate * 100).toFixed(2)}%
              </p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
