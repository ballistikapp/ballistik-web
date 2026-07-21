"use client";

import type { ReactNode } from "react";
import { ImagePlus, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { LaunchFunnelFormValues } from "@/components/launch/launch-funnel-form-values";
import {
  toPreviewMoneyDisplay,
} from "@/components/launch/preview-money";
import { cn } from "@/lib/utils";
import type { LaunchPlatformPreviewResult } from "@/server/schemas/launch-platform.schema";

type LaunchReviewSectionProps = {
  values: LaunchFunnelFormValues;
  preview: LaunchPlatformPreviewResult | undefined;
  previewLoading?: boolean;
  previewError?: string | null;
  imagePreview: string | null;
  bannerPreview: string | null;
  description: string;
  showSubmitFooter?: boolean;
};

const reserveTooltips = {
  creator:
    "Temporary SOL reserved for token creation and creator-side launch steps. Any unused amount is expected to be returned after launch cleanup.",
  buy: "Temporary SOL reserved across buy wallets so bundle execution can complete smoothly. Any unused amount is expected to be returned after launch cleanup.",
  transfer:
    "A small temporary amount reserved so launch wallets can return remaining SOL during cleanup.",
};

function MoneyLine({
  label,
  amount,
  inactive = false,
}: {
  label: ReactNode;
  amount: number;
  inactive?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex items-center justify-between",
        inactive && "opacity-50 line-through"
      )}
    >
      <div className="text-muted-foreground">{label}</div>
      <span className="tabular-nums">{amount.toFixed(4)} SOL</span>
    </div>
  );
}

function ReserveLine({
  label,
  amount,
  tooltip,
  inactive = false,
}: {
  label: string;
  amount: string;
  tooltip: string;
  inactive?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex items-center justify-between",
        inactive && "opacity-50"
      )}
    >
      <div className="flex items-center gap-1.5 text-muted-foreground">
        <span>{label}</span>
        <Tooltip>
          <TooltipTrigger asChild>
            <button type="button" aria-label={`${label} info`}>
              <Info className="size-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="top">{tooltip}</TooltipContent>
        </Tooltip>
      </div>
      <span className="tabular-nums text-xs text-muted-foreground">
        {amount}
      </span>
    </div>
  );
}

export function LaunchReviewSection({
  values,
  preview,
  previewLoading = false,
  previewError = null,
  imagePreview,
  bannerPreview,
  description,
  showSubmitFooter = true,
}: LaunchReviewSectionProps) {
  const { metadata, config } = values;
  const isVideoPreview = Boolean(imagePreview?.startsWith("data:video"));
  const money = toPreviewMoneyDisplay(preview, config);
  const calculating = previewLoading || (!previewError && !money);

  return (
    <div className="space-y-8">
      <div className="space-y-6">
        <div className="flex items-start gap-4">
          {imagePreview ? (
            isVideoPreview ? (
              <video
                src={imagePreview}
                className="h-16 w-16 rounded-xl object-cover"
                muted
                loop
                playsInline
                autoPlay
              />
            ) : (
              <img
                src={imagePreview}
                alt="Token"
                className="h-16 w-16 rounded-xl object-cover"
              />
            )
          ) : (
            <div className="flex h-16 w-16 items-center justify-center rounded-xl bg-muted">
              <ImagePlus className="h-6 w-6 text-muted-foreground" />
            </div>
          )}
          <div>
            <p className="text-lg font-semibold">
              {metadata.tokenName || "Token Name"}
            </p>
            <p className="text-sm text-muted-foreground">
              ${metadata.tokenSymbol || "SYMBOL"}
            </p>
          </div>
        </div>
        {bannerPreview && (
          <div className="overflow-hidden rounded-xl border">
            <img
              src={bannerPreview}
              alt="Banner"
              className="h-24 w-full object-cover"
            />
          </div>
        )}
        <div className="grid gap-3 text-sm">
          <div className="grid grid-cols-[140px_1fr] gap-2">
            <span className="text-muted-foreground">Description</span>
            <span className="line-clamp-3 whitespace-pre-line text-foreground">
              {description}
            </span>
          </div>
          {(metadata.twitter || metadata.telegram || metadata.website) && (
            <div className="grid grid-cols-[140px_1fr] gap-2">
              <span className="text-muted-foreground">Social Links</span>
              <div className="flex gap-2">
                {metadata.twitter && (
                  <span className="rounded bg-muted px-2 py-0.5 text-xs">
                    Twitter
                  </span>
                )}
                {metadata.telegram && (
                  <span className="rounded bg-muted px-2 py-0.5 text-xs">
                    Telegram
                  </span>
                )}
                {metadata.website && (
                  <span className="rounded bg-muted px-2 py-0.5 text-xs">
                    Website
                  </span>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="grid gap-6 border-t pt-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div>
          <div className="mb-3 text-sm font-medium">Launch Configuration</div>
          {values.platform === "PUMPFUN" && (
            <div className="grid gap-3 text-sm">
              <div className="grid grid-cols-[140px_1fr] gap-2">
                <span className="text-muted-foreground">Dev Wallet</span>
                <span>
                  {config.devWalletOption === "import"
                    ? "Imported wallet"
                    : config.devWalletOption === "generate"
                      ? "Will be generated"
                      : "Main Wallet (used as dev)"}
                </span>
              </div>
              <div className="grid grid-cols-[140px_1fr] gap-2">
                <span className="text-muted-foreground">Dev Buy</span>
                <span>{config.devBuyAmountSol.toFixed(4)} SOL</span>
              </div>
              {config.bundleBuyEnabled ? (
                <>
                  <div className="grid grid-cols-[140px_1fr] gap-2">
                    <span className="text-muted-foreground">Jito Tip</span>
                    <span>{config.jitoTipAmountSol.toFixed(4)} SOL</span>
                  </div>
                  <div className="grid grid-cols-[140px_1fr] gap-2">
                    <span className="text-muted-foreground">Bundle Buy</span>
                    <span>
                      {config.bundlerWalletCount} wallets ×{" "}
                      {config.bundlerBuyAmountSol} SOL (±
                      {config.bundlerBuyVariancePercent}%)
                    </span>
                  </div>
                  {config.distributionWalletMultiplier > 1 && (
                    <div className="grid grid-cols-[140px_1fr] gap-2">
                      <span className="text-muted-foreground">Distribution</span>
                      <span>
                        {config.bundlerWalletCount *
                          config.distributionWalletMultiplier}{" "}
                        wallets after ×{config.distributionWalletMultiplier}
                      </span>
                    </div>
                  )}
                </>
              ) : (
                <div className="grid grid-cols-[140px_1fr] gap-2">
                  <span className="text-muted-foreground">Bundle Buy</span>
                  <span>Disabled</span>
                </div>
              )}
              <div className="grid grid-cols-[140px_1fr] gap-2">
                <span className="text-muted-foreground">Vanity Address</span>
                <span>{config.vanityMint ? "Enabled" : "Disabled"}</span>
              </div>
              <div className="grid grid-cols-[140px_1fr] gap-2">
                <span className="text-muted-foreground">Attribution</span>
                <span>
                  {config.removeAttribution
                    ? "Removed"
                    : "Included by default"}
                </span>
              </div>
              <div className="grid grid-cols-[140px_1fr] gap-2">
                <span className="text-muted-foreground">Mayhem Mode</span>
                <span
                  className={
                    config.mayhemMode
                      ? "font-medium text-amber-500"
                      : undefined
                  }
                >
                  {config.mayhemMode ? "Enabled (beta)" : "Disabled"}
                </span>
              </div>
            </div>
          )}
        </div>

        <div className="h-fit rounded-xl border bg-muted/30 p-4">
          {previewError ? (
            <p className="text-sm text-destructive">
              Could not calculate launch costs. Please retry.
            </p>
          ) : calculating || !money ? (
            <p className="text-sm text-muted-foreground">
              Calculating latest breakdown...
            </p>
          ) : (
            <div className="space-y-3 text-sm">
              <div className="flex items-center justify-between border-b pb-3">
                <span className="font-medium">Total fees</span>
                <span className="tabular-nums font-medium">
                  {money.usageFeeSol.toFixed(4)} SOL
                </span>
              </div>
              {money.platformFeeWaived ? (
                <div className="text-xs text-emerald-400">
                  Pro active. Platform fees are waived for this launch.
                </div>
              ) : money.platformFeeDiscountRate > 0 ? (
                <div className="text-xs text-emerald-400">
                  Developer active. Platform fees are reduced by{" "}
                  {Math.round(money.platformFeeDiscountRate * 100)}%.
                </div>
              ) : null}
              <MoneyLine
                label={
                  <>
                    Generated wallets fee
                    <span className="ml-2 text-xs">
                      ({money.generatedWalletCountFromLabel} wallets)
                    </span>
                  </>
                }
                amount={money.generatedWalletFeeSol}
                inactive={money.generatedWalletCountFromLabel === 0}
              />
              {money.customDevWalletFeeSol > 0 && (
                <MoneyLine
                  label="Custom dev wallet fee"
                  amount={money.customDevWalletFeeSol}
                />
              )}
              <MoneyLine
                label="Vanity mint fee"
                amount={money.vanityFeeSol}
                inactive={!config.vanityMint}
              />
              <MoneyLine
                label="Attribution removal fee"
                amount={money.attributionFeeSol}
                inactive={!config.removeAttribution}
              />
              <MoneyLine
                label="Bundler fee"
                amount={money.bundleFeeSol}
                inactive={!config.bundleBuyEnabled}
              />
              <div className="border-t pt-3">
                <div className="mb-2 flex items-center justify-between">
                  <span className="font-medium">Temporary reserves</span>
                  <span className="text-xs text-muted-foreground">
                    Will be returned
                  </span>
                </div>
                <div className="space-y-2">
                  <ReserveLine
                    label="Creator reserve"
                    amount={`${money.creatorReserveSol.toFixed(4)} SOL`}
                    tooltip={reserveTooltips.creator}
                  />
                  <ReserveLine
                    label="Buy wallet reserve"
                    amount={
                      config.bundleBuyEnabled
                        ? `${money.buyWalletReserveSol.toFixed(4)} SOL`
                        : "Not needed"
                    }
                    tooltip={reserveTooltips.buy}
                    inactive={!config.bundleBuyEnabled}
                  />
                  <ReserveLine
                    label="Transfer reserve"
                    amount={`${money.transferReserveSol.toFixed(4)} SOL`}
                    tooltip={reserveTooltips.transfer}
                  />
                </div>
              </div>
              <div className="flex items-center justify-between border-t pt-3">
                <span className="font-medium">
                  Estimated main-wallet spend
                </span>
                <span className="tabular-nums font-medium">
                  {money.estimatedSpendSol.toFixed(4)} SOL
                </span>
              </div>
            </div>
          )}
        </div>
      </div>

      {showSubmitFooter && (
        <div className="-mx-4 mt-8 border-t bg-muted/30 px-4 py-8 md:-mx-6 md:px-6 md:py-10 xl:-mx-8 xl:px-8">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 lg:flex lg:items-center lg:gap-10">
              <div>
                <div className="text-xs text-muted-foreground">Total fees</div>
                <div className="text-2xl font-light tabular-nums">
                  {money ? money.usageFeeSol.toFixed(4) : "—"}{" "}
                  <span className="text-sm text-muted-foreground">SOL</span>
                </div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">
                  Total generated wallets
                </div>
                <div className="text-2xl font-light tabular-nums">
                  {money ? money.generatedWalletCountFromLabel : "—"}
                </div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">
                  Estimated main-wallet spend
                </div>
                <div className="text-2xl font-light tabular-nums">
                  {money ? money.estimatedSpendSol.toFixed(4) : "—"}{" "}
                  <span className="text-sm text-muted-foreground">SOL</span>
                </div>
              </div>
            </div>
            <Button
              size="lg"
              type="submit"
              form="launch-form"
              disabled={previewLoading || Boolean(previewError) || !preview}
              className="h-11 w-full shrink-0 border border-black px-4 text-xl font-black tracking-tight text-black/90 shadow-lg shadow-lime-400/10 hover:text-black hover:shadow-xl hover:shadow-lime-300/20 sm:w-auto sm:text-2xl md:h-12 md:text-3xl"
            >
              LAUNCH TOKEN
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
