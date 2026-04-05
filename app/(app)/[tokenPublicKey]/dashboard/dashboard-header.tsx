"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { GalleryVerticalEnd, RefreshCw, Copy, Check } from "lucide-react";
import { IconBrandX, IconBrandTelegram, IconWorld } from "@tabler/icons-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface TokenData {
  name: string;
  symbol: string;
  publicKey: string;
  imageUrl: string | null;
  twitterUrl: string | null;
  telegramUrl: string | null;
  websiteUrl: string | null;
}

interface DashboardHeaderProps {
  token: TokenData;
  onRefresh: () => void;
  isRefreshing?: boolean;
  refreshStatusLabel: string;
}

function truncatePublicKey(key: string) {
  return `${key.slice(0, 6)}...${key.slice(-4)}`;
}

export function DashboardHeader({
  token,
  onRefresh,
  isRefreshing,
  refreshStatusLabel,
}: DashboardHeaderProps) {
  const [imageExpanded, setImageExpanded] = useState(false);
  const [isAddressCopied, setIsAddressCopied] = useState(false);

  const pumpUrl = `https://pump.fun/coin/${token.publicKey}`;
  const solscanUrl = `https://solscan.io/token/${token.publicKey}`;
  const hasMetadataLinks = Boolean(
    token.twitterUrl || token.telegramUrl || token.websiteUrl
  );

  const handleCopyAddress = async () => {
    try {
      await navigator.clipboard.writeText(token.publicKey);
      setIsAddressCopied(true);
      window.setTimeout(() => setIsAddressCopied(false), 1200);
    } catch {}
  };

  return (
    <>
      <div className="flex items-center gap-6 px-1 py-2 flex-wrap @xl/main:flex-nowrap">
        <div className="flex items-center gap-3 shrink-0">
          <button
            type="button"
            className="relative flex items-center justify-center rounded-lg overflow-hidden shrink-0 size-11 bg-muted cursor-pointer hover:ring-2 hover:ring-primary/50 transition-all"
            onClick={() => token.imageUrl && setImageExpanded(true)}
          >
            {token.imageUrl ? (
              <Image
                src={token.imageUrl}
                alt={token.name}
                className="object-cover"
                fill
                sizes="44px"
              />
            ) : (
              <GalleryVerticalEnd className="size-5 text-muted-foreground" />
            )}
          </button>
          <div className="flex flex-col min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-lg leading-tight">
                {token.name}
              </span>
              <Badge variant="secondary" className="text-xs font-mono">
                ${token.symbol}
              </Badge>
            </div>
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span className="font-mono">
                {truncatePublicKey(token.publicKey)}
              </span>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-6"
                    onClick={handleCopyAddress}
                  >
                    {isAddressCopied ? (
                      <Check className="size-3.5" />
                    ) : (
                      <Copy className="size-3.5" />
                    )}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  {isAddressCopied ? "Copied" : "Copy address"}
                </TooltipContent>
              </Tooltip>
            </div>
          </div>
        </div>

        <div className="h-6 w-px bg-border hidden @xl/main:block" />

        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-3">
          {hasMetadataLinks && (
            <div className="flex items-center gap-1">
              {token.twitterUrl && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-8"
                      asChild
                    >
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
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-8"
                      asChild
                    >
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
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-8"
                      asChild
                    >
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
            </div>
          )}

          {hasMetadataLinks && <div className="w-px h-4 bg-border mx-0.5" />}

          <div className="flex items-center gap-1 shrink-0">
            <div className="flex items-center gap-1">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-8"
                    asChild
                  >
                    <Link
                      href={pumpUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src="https://pump.fun/favicon.ico"
                        alt="pump.fun"
                        className="size-3.5 rounded-sm"
                      />
                    </Link>
                  </Button>
                </TooltipTrigger>
                <TooltipContent>pump.fun</TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-8"
                    asChild
                  >
                    <Link
                      href={solscanUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <Image
                        src="/logos/solscan-logo-dark.svg"
                        alt="Solscan"
                        width={14}
                        height={14}
                        className="size-3.5"
                      />
                    </Link>
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Solscan</TooltipContent>
              </Tooltip>
            </div>
          </div>

          <div className="ml-auto flex shrink-0 items-center gap-3">
            <p className="text-sm text-muted-foreground" aria-live="polite">
              {refreshStatusLabel}
            </p>

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
