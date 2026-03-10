"use client";

import * as React from "react";
import { ImagePlus } from "lucide-react";
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
    devWalletOption: "import" | "generate" | "use_main";
    importedDevWalletKey: string;
    devBuyAmountSol: number;
    jitoTipAmountSol: number;
    bundleBuyEnabled: boolean;
    vanityMint: boolean;
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
  const quoteLoading = previewCostsQuery.isLoading || previewCostsQuery.isFetching;
  const quoteError = previewCostsQuery.error?.message ?? null;
  const canConfirm =
    preview?.hasSufficientMainWallet === true &&
    !quoteLoading &&
    !isLoading;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-xl">Launch Overview</DialogTitle>
          <DialogDescription>
            Review your token details before launching
          </DialogDescription>
        </DialogHeader>
        <Separator />
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
            <div className="text-sm font-medium mb-3">Launch Configuration</div>
            <div className="grid gap-3 text-sm">
              <div className="grid grid-cols-[140px_1fr] gap-2">
                <span className="text-muted-foreground">Dev Wallet</span>
                <span>
                  {launchInput.devWalletOption === "import"
                    ? "Imported wallet"
                    : launchInput.devWalletOption === "generate"
                      ? "Will be generated"
                      : "Main wallet"}
                </span>
              </div>
              <div className="grid grid-cols-[140px_1fr] gap-2">
                <span className="text-muted-foreground">Dev Buy</span>
                <span>{launchInput.devBuyAmountSol.toFixed(4)} SOL</span>
              </div>
              <div className="grid grid-cols-[140px_1fr] gap-2">
                <span className="text-muted-foreground">Jito Tip</span>
                <span>{launchInput.jitoTipAmountSol.toFixed(4)} SOL</span>
              </div>
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
                        {launchInput.distributionWalletMultiplier} distribution
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
                  <span className="text-muted-foreground">Vanity Address</span>
                  <span className="text-green-600">Enabled</span>
                </div>
              )}
            </div>
          </div>

          <div className="border-t pt-4">
            <div className="flex items-center justify-between mb-3">
              <div className="text-sm font-medium">Pre-Launch Cost Breakdown</div>
              <div className="text-xs text-muted-foreground">Based on current balances</div>
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
              <div className="space-y-2 text-sm">
                <div className="rounded-md border bg-muted/30 p-3 mb-2">
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Main wallet balance</span>
                    <span className="tabular-nums">
                      {preview.mainWalletBalanceSol.toFixed(4)} SOL
                    </span>
                  </div>
                  <div className="flex items-center justify-between mt-1">
                    <span className="text-muted-foreground">Required at start</span>
                    <span className="tabular-nums">
                      {preview.requiredMainWalletSol.toFixed(4)} SOL
                    </span>
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Main wallet charged now</span>
                  <span className="tabular-nums">
                    {preview.chargedNowSol.toFixed(4)} SOL
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Temporary wallet funding</span>
                  <span className="tabular-nums">
                    {preview.temporaryFundingSol.toFixed(4)} SOL
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Expected returned later</span>
                  <span className="tabular-nums">
                    {preview.expectedReturnSol.toFixed(4)} SOL
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Permanent spend</span>
                  <span className="tabular-nums">
                    {preview.permanentSpendSol.toFixed(4)} SOL
                  </span>
                </div>
                <div className="flex items-center justify-between pt-2 border-t">
                  <span className="font-medium">
                    Estimated final main-wallet spend
                  </span>
                  <span className="tabular-nums font-medium">
                    {preview.netMainWalletDeltaAfterCleanupSol.toFixed(4)} SOL
                  </span>
                </div>
                <div className="rounded-md border bg-muted/30 p-3 mt-2 space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">
                      Bundle variance reserve
                    </span>
                    <span className="tabular-nums">
                      {preview.lineItems.bundleBuyVarianceReserveSol.toFixed(4)}{" "}
                      SOL
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Usage fees</span>
                    <span className="tabular-nums">
                      {preview.lineItems.usageFeesSol.toFixed(4)} SOL
                    </span>
                  </div>
                </div>
                {preview.riskNotes.length > 0 && (
                  <div className="rounded-md border bg-muted/30 p-3 mt-2 space-y-1">
                    {preview.riskNotes.map((note) => (
                      <p key={note} className="text-xs text-muted-foreground">
                        - {note}
                      </p>
                    ))}
                  </div>
                )}
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
