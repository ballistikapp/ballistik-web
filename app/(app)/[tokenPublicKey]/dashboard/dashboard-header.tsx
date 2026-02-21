"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import {
  GalleryVerticalEnd,
  ExternalLink,
  RefreshCw,
  CheckCircle2,
} from "lucide-react";
import {
  IconBrandX,
  IconBrandTelegram,
  IconWorld,
} from "@tabler/icons-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

import { formatPriceSol, formatMarketCap, formatUsd } from "@/lib/utils/format";

const GRADUATION_SOL_THRESHOLD = 85;

interface TokenData {
  name: string;
  symbol: string;
  publicKey: string;
  imageUrl: string | null;
  twitterUrl: string | null;
  telegramUrl: string | null;
  websiteUrl: string | null;
}

interface HeaderData {
  priceSol: number;
  solPriceUsd: number;
  marketCapSol: number;
  marketCapUsd: number;
  isComplete: boolean;
  realSolReserves: number;
}

interface DashboardHeaderProps {
  token: TokenData;
  header: HeaderData;
  onRefresh: () => void;
  isRefreshing?: boolean;
}

export function DashboardHeader({
  token,
  header,
  onRefresh,
  isRefreshing,
}: DashboardHeaderProps) {
  const progressPercent = header.isComplete
    ? 100
    : Math.min(
        (header.realSolReserves / GRADUATION_SOL_THRESHOLD) * 100,
        99.9
      );
  const solRemaining = Math.max(
    GRADUATION_SOL_THRESHOLD - header.realSolReserves,
    0
  );

  const [imageExpanded, setImageExpanded] = useState(false);

  const pumpUrl = `https://pump.fun/coin/${token.publicKey}`;
  const solscanUrl = `https://solscan.io/token/${token.publicKey}`;

  return (
    <>
    <div className="flex items-center gap-4 px-1 py-1 flex-wrap @xl/main:flex-nowrap">
      <div className="flex items-center gap-3 shrink-0">
        <button
          type="button"
          className="relative flex items-center justify-center rounded-lg overflow-hidden shrink-0 size-9 bg-muted cursor-pointer hover:ring-2 hover:ring-primary/50 transition-all"
          onClick={() => token.imageUrl && setImageExpanded(true)}
        >
          {token.imageUrl ? (
            <Image
              src={token.imageUrl}
              alt={token.name}
              className="object-cover"
              fill
              sizes="36px"
            />
          ) : (
            <GalleryVerticalEnd className="size-4 text-muted-foreground" />
          )}
        </button>
        <div className="flex items-center gap-2">
          <span className="font-semibold text-base leading-tight">
            {token.name}
          </span>
          <Badge variant="secondary" className="text-xs font-mono">
            ${token.symbol}
          </Badge>
        </div>
      </div>

      <div className="h-6 w-px bg-border hidden @xl/main:block" />

      <div className="flex items-center gap-1.5 shrink-0">
        <span className="text-xs text-muted-foreground">MCap</span>
        {header.marketCapUsd > 0 ? (
          <span className="font-bold text-lg tabular-nums font-mono">
            {formatUsd(header.marketCapUsd)}
          </span>
        ) : (
          <span className="font-bold text-lg tabular-nums font-mono">
            {formatMarketCap(header.marketCapSol)} SOL
          </span>
        )}
        {header.marketCapUsd > 0 && (
          <span className="text-sm tabular-nums font-mono text-muted-foreground">
            {formatMarketCap(header.marketCapSol)} SOL
          </span>
        )}
      </div>

      <div className="h-6 w-px bg-border hidden @xl/main:block" />

      <div className="flex items-center gap-1.5 shrink-0">
        <span className="text-xs text-muted-foreground">Price</span>
        <span className="text-sm tabular-nums font-mono text-muted-foreground">
          {formatPriceSol(header.priceSol)} SOL
        </span>
      </div>

      <div className="h-6 w-px bg-border hidden @xl/main:block" />

      <div className="flex items-center gap-3 min-w-0 flex-1">
        {header.isComplete ? (
          <div className="flex items-center gap-1.5">
            <CheckCircle2 className="size-4 text-green-500" />
            <span className="text-sm font-medium text-green-500">
              Graduated
            </span>
          </div>
        ) : (
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="flex items-center gap-2 min-w-0 flex-1 max-w-64">
                <Progress
                  value={progressPercent}
                  className="h-2.5 flex-1"
                />
                <span className="text-xs tabular-nums text-muted-foreground whitespace-nowrap">
                  {progressPercent.toFixed(1)}%
                </span>
              </div>
            </TooltipTrigger>
            <TooltipContent>
              <p>
                {header.realSolReserves.toFixed(2)} /{" "}
                {GRADUATION_SOL_THRESHOLD} SOL
              </p>
              <p className="text-muted-foreground">
                {solRemaining.toFixed(2)} SOL to graduate
              </p>
            </TooltipContent>
          </Tooltip>
        )}
      </div>

      <div className="h-6 w-px bg-border hidden @xl/main:block" />

      <div className="flex items-center gap-1 shrink-0">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" className="size-8" asChild>
              <Link href={pumpUrl} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="size-3.5" />
              </Link>
            </Button>
          </TooltipTrigger>
          <TooltipContent>pump.fun</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" className="size-8" asChild>
              <Link
                href={solscanUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  className="size-3.5"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <circle cx="11" cy="11" r="8" />
                  <path d="m21 21-4.3-4.3" />
                </svg>
              </Link>
            </Button>
          </TooltipTrigger>
          <TooltipContent>Solscan</TooltipContent>
        </Tooltip>

        {token.twitterUrl && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="size-8" asChild>
                <Link
                  href={token.twitterUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <IconBrandX className="size-3.5" />
                </Link>
              </Button>
            </TooltipTrigger>
            <TooltipContent>Twitter / X</TooltipContent>
          </Tooltip>
        )}

        {token.telegramUrl && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="size-8" asChild>
                <Link
                  href={token.telegramUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <IconBrandTelegram className="size-3.5" />
                </Link>
              </Button>
            </TooltipTrigger>
            <TooltipContent>Telegram</TooltipContent>
          </Tooltip>
        )}

        {token.websiteUrl && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="size-8" asChild>
                <Link
                  href={token.websiteUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <IconWorld className="size-3.5" />
                </Link>
              </Button>
            </TooltipTrigger>
            <TooltipContent>Website</TooltipContent>
          </Tooltip>
        )}

        <div className="w-px h-4 bg-border mx-0.5" />

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="size-8"
              onClick={onRefresh}
              disabled={isRefreshing}
            >
              <RefreshCw
                className={`size-3.5 ${isRefreshing ? "animate-spin" : ""}`}
              />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Refresh data</TooltipContent>
        </Tooltip>
      </div>
    </div>

    {imageExpanded && token.imageUrl && (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm cursor-pointer"
        onClick={() => setImageExpanded(false)}
      >
        <div className="relative size-72 @xl/main:size-96 rounded-xl overflow-hidden shadow-2xl">
          <Image
            src={token.imageUrl}
            alt={token.name}
            className="object-cover"
            fill
            sizes="384px"
          />
        </div>
      </div>
    )}
    </>
  );
}
