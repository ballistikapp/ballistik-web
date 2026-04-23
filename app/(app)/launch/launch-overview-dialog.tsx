"use client";

import * as React from "react";
import { ImagePlus, InfoIcon } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  bundleBuyFeeSol,
  descriptionAttributionRemovalFeeSol,
  nonSystemDevWalletFeeSol,
  vanityMintFeeSol,
} from "@/lib/config/usage-fees.config";
import { trpc } from "@/lib/trpc/client";

interface LaunchOverviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  launchInput: {
    tokenName: string;
    tokenSymbol: string;
    description: string;
    tokenImage: string;
    tokenBanner: string;
    twitter: string;
    telegram: string;
    website: string;
    devWalletOption: "system" | "import" | "generate" | "use_main";
    importedDevWalletKey: string;
    devBuyAmountSol: number;
    jitoTipAmountSol: number;
    bundleBuyEnabled: boolean;
    vanityMint: boolean;
    removeAttribution: boolean;
    bundlerWalletCount: number;
    bundlerBuyAmountSol: number;
    bundlerBuyVariancePercent: number;
    distributionWalletMultiplier: number;
  };
  imagePreview: string | null;
  bannerPreview: string | null;
  isLoading?: boolean;
}

export function LaunchOverviewDialog({
  open,
  onOpenChange,
  onConfirm,
  launchInput,
  imagePreview,
  bannerPreview,
  isLoading = false,
}: LaunchOverviewDialogProps) {
  const isVideoPreview = Boolean(imagePreview?.startsWith("data:video"));
  const previewInput = React.useMemo(
    () => ({
      devWalletOption: launchInput.devWalletOption,
      importedDevWalletKey:
        launchInput.devWalletOption === "import"
          ? launchInput.importedDevWalletKey
          : undefined,
      devBuyAmountSol: launchInput.devBuyAmountSol,
      jitoTipAmountSol: launchInput.jitoTipAmountSol,
      bundleBuyEnabled: launchInput.bundleBuyEnabled,
      vanityMint: launchInput.vanityMint,
      removeAttribution: launchInput.removeAttribution,
      bundlerWalletCount: launchInput.bundlerWalletCount,
      bundlerBuyAmountSol: launchInput.bundlerBuyAmountSol,
      bundlerBuyVariancePercent: launchInput.bundlerBuyVariancePercent,
      distributionWalletMultiplier: launchInput.distributionWalletMultiplier,
    }),
    [launchInput]
  );
  const previewCostsQuery = trpc.launch.previewCosts.useQuery(previewInput, {
    enabled: open,
    refetchOnWindowFocus: false,
  });
  const preview = previewCostsQuery.data;
  const quoteLoading =
    previewCostsQuery.isLoading || previewCostsQuery.isFetching;
  const quoteError = previewCostsQuery.error?.message ?? null;
  const canConfirm =
    preview?.hasSufficientMainWallet === true && !quoteLoading && !isLoading;
  const generatedWalletCount =
    (launchInput.devWalletOption === "generate" ? 1 : 0) +
    (launchInput.bundleBuyEnabled
      ? launchInput.bundlerWalletCount +
        launchInput.bundlerWalletCount *
          Math.max(0, launchInput.distributionWalletMultiplier - 1)
      : 0);
  const vanityFeeDisplaySol = launchInput.vanityMint
    ? (preview?.lineItems.vanityMintFeeSol ?? vanityMintFeeSol)
    : vanityMintFeeSol;
  const attributionFeeDisplaySol = launchInput.removeAttribution
    ? (preview?.lineItems.descriptionAttributionRemovalFeeSol ??
      descriptionAttributionRemovalFeeSol)
    : descriptionAttributionRemovalFeeSol;
  const bundleFeeDisplaySol = launchInput.bundleBuyEnabled
    ? (preview?.lineItems.bundleBuyFeeSol ?? bundleBuyFeeSol)
    : bundleBuyFeeSol;
  const customDevWalletFeeDisplaySol =
    launchInput.devWalletOption !== "system"
      ? (preview?.lineItems.nonSystemDevWalletFeeSol ??
        nonSystemDevWalletFeeSol)
      : nonSystemDevWalletFeeSol;
  const temporaryReserveItems = preview
    ? [
        {
          label: "Creator reserve",
          amount: `${preview.lineItems.creatorReserveSol.toFixed(4)} SOL`,
          tooltip:
            "Temporary SOL reserved for token creation and creator-side launch steps. Any unused amount is expected to be returned after launch cleanup.",
        },
        {
          label: "Buy wallet reserve",
          amount: launchInput.bundleBuyEnabled
            ? `${preview.lineItems.buyWalletReserveSol.toFixed(4)} SOL`
            : "Not needed",
          tooltip:
            "Temporary SOL reserved across buy wallets so bundle execution can complete smoothly. Any unused amount is expected to be returned after launch cleanup.",
        },
        {
          label: "Transfer reserve",
          amount: `${preview.lineItems.transferReserveSol.toFixed(4)} SOL`,
          tooltip:
            "A small temporary amount reserved so launch wallets can send remaining SOL back during cleanup. Any unused amount is expected to be returned after launch cleanup.",
        },
      ]
    : ([
        {
          label: "Creator reserve",
          amount: "Calculating...",
          tooltip:
            "Temporary SOL reserved for token creation and creator-side launch steps. Any unused amount is expected to be returned after launch cleanup.",
        },
        {
          label: "Buy wallet reserve",
          amount: launchInput.bundleBuyEnabled
            ? "Calculating..."
            : "Not needed",
          tooltip:
            "Temporary SOL reserved across buy wallets so bundle execution can complete smoothly. Any unused amount is expected to be returned after launch cleanup.",
        },
        {
          label: "Transfer reserve",
          amount: "Calculating...",
          tooltip:
            "A small temporary amount reserved so launch wallets can send remaining SOL back during cleanup. Any unused amount is expected to be returned after launch cleanup.",
        },
      ] as const);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(90vw,900px)] max-w-none sm:max-w-none max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-xl">Launch Overview</DialogTitle>
          <DialogDescription>
            Review your token details before launching
          </DialogDescription>
        </DialogHeader>
        <Separator />
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
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
                <div className="h-16 w-16 rounded-xl bg-muted flex items-center justify-center">
                  <ImagePlus className="h-6 w-6 text-muted-foreground" />
                </div>
              )}
              <div>
                <p className="text-lg font-semibold">
                  {launchInput.tokenName || "Token Name"}
                </p>
                <p className="text-sm text-muted-foreground">
                  ${launchInput.tokenSymbol || "SYMBOL"}
                </p>
              </div>
            </div>
            {bannerPreview && (
              <div className="rounded-xl overflow-hidden border">
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
                <span className="text-foreground line-clamp-2">
                  {launchInput.description || "-"}
                </span>
              </div>
              {(launchInput.twitter ||
                launchInput.telegram ||
                launchInput.website) && (
                <div className="grid grid-cols-[140px_1fr] gap-2">
                  <span className="text-muted-foreground">Social Links</span>
                  <div className="flex gap-2">
                    {launchInput.twitter && (
                      <span className="text-xs bg-muted px-2 py-0.5 rounded">
                        Twitter
                      </span>
                    )}
                    {launchInput.telegram && (
                      <span className="text-xs bg-muted px-2 py-0.5 rounded">
                        Telegram
                      </span>
                    )}
                    {launchInput.website && (
                      <span className="text-xs bg-muted px-2 py-0.5 rounded">
                        Website
                      </span>
                    )}
                  </div>
                </div>
              )}
            </div>

            <div className="border-t pt-4">
              <div className="text-sm font-medium mb-3">
                Launch Configuration
              </div>
              <div className="grid gap-3 text-sm">
                <div className="grid grid-cols-[140px_1fr] gap-2">
                  <span className="text-muted-foreground">Dev Wallet</span>
                  <span>
                    {launchInput.devWalletOption === "system"
                      ? "Ballistik Wallet"
                      : launchInput.devWalletOption === "import"
                        ? "Imported wallet"
                        : launchInput.devWalletOption === "generate"
                          ? "Will be generated"
                          : "Main Wallet (used as dev)"}
                  </span>
                </div>
                <div className="grid grid-cols-[140px_1fr] gap-2">
                  <span className="text-muted-foreground">Dev Buy</span>
                  <span>{launchInput.devBuyAmountSol.toFixed(4)} SOL</span>
                </div>
                {launchInput.bundleBuyEnabled && (
                  <div className="grid grid-cols-[140px_1fr] gap-2">
                    <span className="text-muted-foreground">Jito Tip</span>
                    <span>{launchInput.jitoTipAmountSol.toFixed(4)} SOL</span>
                  </div>
                )}
                {launchInput.bundleBuyEnabled && (
                  <>
                    <div className="grid grid-cols-[140px_1fr] gap-2">
                      <span className="text-muted-foreground">Bundle Buy</span>
                      <span>
                        {launchInput.bundlerWalletCount} wallets ×{" "}
                        {launchInput.bundlerBuyAmountSol} SOL (±
                        {launchInput.bundlerBuyVariancePercent}%)
                      </span>
                    </div>
                    {launchInput.distributionWalletMultiplier > 1 && (
                      <div className="grid grid-cols-[140px_1fr] gap-2">
                        <span className="text-muted-foreground">
                          Distribution
                        </span>
                        <span>
                          {launchInput.bundlerWalletCount *
                            launchInput.distributionWalletMultiplier}{" "}
                          wallets after ×
                          {launchInput.distributionWalletMultiplier}{" "}
                          distribution
                        </span>
                      </div>
                    )}
                  </>
                )}
                {!launchInput.bundleBuyEnabled && (
                  <div className="grid grid-cols-[140px_1fr] gap-2">
                    <span className="text-muted-foreground">Bundle Buy</span>
                    <span>Disabled</span>
                  </div>
                )}
                {launchInput.vanityMint && (
                  <div className="grid grid-cols-[140px_1fr] gap-2">
                    <span className="text-muted-foreground">
                      Vanity Address
                    </span>
                    <span className="text-green-600">Enabled</span>
                  </div>
                )}
                <div className="grid grid-cols-[140px_1fr] gap-2">
                  <span className="text-muted-foreground">Attribution</span>
                  <span>
                    {launchInput.removeAttribution
                      ? "Removed (+0.1 SOL)"
                      : "Included by default"}
                  </span>
                </div>
              </div>
            </div>
          </div>

          <div className="border-t pt-4 lg:border-t-0 lg:border-l lg:pl-6">
            <div className="flex items-center justify-between mb-3">
              <div className="text-sm font-medium">
                Pre-Launch Cost Breakdown
              </div>
              <div className="text-xs text-muted-foreground">
                Based on current balances
              </div>
            </div>
            {quoteLoading && (
              <p className="text-sm text-muted-foreground">
                Calculating latest breakdown...
              </p>
            )}
            {!quoteLoading && quoteError && (
              <p className="text-sm text-destructive">
                Could not calculate launch costs. Please retry.
              </p>
            )}
            {!quoteLoading && preview && (
              <div className="space-y-3 text-sm">
                <div className="rounded-md border bg-muted/30 p-3">
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">
                      Main wallet balance
                    </span>
                    <span className="tabular-nums">
                      {preview.mainWalletBalanceSol.toFixed(4)} SOL
                    </span>
                  </div>
                  <div className="mt-1 flex items-center justify-between">
                    <span className="text-muted-foreground">
                      Required at start
                    </span>
                    <span className="tabular-nums">
                      {preview.requiredMainWalletSol.toFixed(4)} SOL
                    </span>
                  </div>
                  <div className="mt-1 flex items-center justify-between border-t pt-2">
                    <span className="font-medium">
                      Estimated main-wallet spend
                    </span>
                    <span className="tabular-nums font-medium">
                      {preview.netMainWalletDeltaAfterCleanupSol.toFixed(4)} SOL
                    </span>
                  </div>
                </div>
                <div className="rounded-md border bg-muted/30 p-3">
                  <div className="flex items-center justify-between border-b pb-2">
                    <span className="font-medium">Total fees</span>
                    <span className="tabular-nums font-medium">
                      {preview.lineItems.usageFeesSol.toFixed(4)} SOL
                    </span>
                  </div>
                  {preview.platformFeeWaived ? (
                    <div className="mt-2 text-xs text-emerald-400">
                      Pro active. Platform fees are waived for this launch.
                    </div>
                  ) : preview.platformFeeDiscountRate != null &&
                    preview.platformFeeDiscountRate > 0 ? (
                    <div className="mt-2 text-xs text-emerald-400">
                      Developer active. Platform fees are reduced by{" "}
                      {Math.round(preview.platformFeeDiscountRate * 100)}%.
                    </div>
                  ) : null}
                  <div className="mt-2 space-y-2">
                    <div
                      className={`flex items-center justify-between ${
                        generatedWalletCount === 0
                          ? "opacity-50 line-through"
                          : ""
                      }`}
                    >
                      <div className="text-muted-foreground">
                        Generated wallets fee
                        <span className="ml-2 text-xs">
                          ({generatedWalletCount} wallets)
                        </span>
                      </div>
                      <span className="tabular-nums">
                        {preview.lineItems.generatedWalletFeeSol.toFixed(4)} SOL
                      </span>
                    </div>
                    <div
                      className={`flex items-center justify-between ${
                        launchInput.devWalletOption === "system"
                          ? "opacity-50 line-through"
                          : ""
                      }`}
                    >
                      <div className="text-muted-foreground">
                        Custom dev wallet fee
                      </div>
                      <span className="tabular-nums">
                        {customDevWalletFeeDisplaySol.toFixed(4)} SOL
                      </span>
                    </div>
                    <div
                      className={`flex items-center justify-between ${
                        launchInput.vanityMint ? "" : "opacity-50 line-through"
                      }`}
                    >
                      <div className="text-muted-foreground">
                        Vanity mint fee
                      </div>
                      <span className="tabular-nums">
                        {vanityFeeDisplaySol.toFixed(4)} SOL
                      </span>
                    </div>
                    <div
                      className={`flex items-center justify-between ${
                        launchInput.removeAttribution
                          ? ""
                          : "opacity-50 line-through"
                      }`}
                    >
                      <div className="text-muted-foreground">
                        Attribution removal fee
                      </div>
                      <span className="tabular-nums">
                        {attributionFeeDisplaySol.toFixed(4)} SOL
                      </span>
                    </div>
                    <div
                      className={`flex items-center justify-between ${
                        launchInput.bundleBuyEnabled
                          ? ""
                          : "opacity-50 line-through"
                      }`}
                    >
                      <div className="text-muted-foreground">Bundler fee</div>
                      <span className="tabular-nums">
                        {bundleFeeDisplaySol.toFixed(4)} SOL
                      </span>
                    </div>
                  </div>
                </div>
                <div className="rounded-md border bg-muted/30 p-3">
                  <div className="flex items-center justify-between border-b pb-2">
                    <span className="font-medium">Temporary reserves</span>
                    <div className="flex items-center gap-1 text-xs text-muted-foreground">
                      <span>Will be returned</span>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            type="button"
                            className="inline-flex text-muted-foreground transition-colors hover:text-foreground"
                            aria-label="Temporary reserves info"
                          >
                            <InfoIcon className="size-3.5" />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent side="top">
                          These are temporary reserves added to help the launch
                          complete. Any unused amount is returned to your main
                          wallet after cleanup.
                        </TooltipContent>
                      </Tooltip>
                    </div>
                  </div>
                  <div className="mt-2 space-y-2">
                    {temporaryReserveItems.map((item) => (
                      <div
                        key={item.label}
                        className={`flex items-center justify-between ${
                          item.amount === "Not needed" ? "opacity-50" : ""
                        }`}
                      >
                        <div className="flex items-center gap-1.5 text-muted-foreground">
                          <span>{item.label}</span>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <button
                                type="button"
                                className="inline-flex text-muted-foreground transition-colors hover:text-foreground"
                                aria-label={`${item.label} info`}
                              >
                                <InfoIcon className="size-3.5" />
                              </button>
                            </TooltipTrigger>
                            <TooltipContent side="top">
                              {item.tooltip}
                            </TooltipContent>
                          </Tooltip>
                        </div>
                        <span className="tabular-nums text-xs text-muted-foreground">
                          {item.amount}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
                {!preview.hasSufficientMainWallet && (
                  <p className="text-xs text-destructive mt-1">
                    Main wallet is below the required start amount.
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isLoading}
          >
            Cancel
          </Button>
          <Button onClick={onConfirm} disabled={!canConfirm}>
            {isLoading
              ? "Launching..."
              : quoteLoading
                ? "Calculating..."
                : preview && !preview.hasSufficientMainWallet
                  ? "Insufficient balance"
                  : "Confirm Launch"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
