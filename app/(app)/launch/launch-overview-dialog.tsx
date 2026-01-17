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

interface LaunchOverviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  formValues: {
    tokenName: string;
    tokenSymbol: string;
    description: string;
    tokenImage: string;
    twitter: string;
    telegram: string;
    website: string;
    devWalletOption: "import" | "generate" | "use_main";
    devBuyAmount: string;
    jitoTipAmount: string;
    bundleBuyEnabled: boolean;
    vanityMint: boolean;
    numberOfWallets: string;
    buyAmountPerWallet: string;
    buyAmountVariance: string;
    distributionMultiplier: string;
  };
  imagePreview: string | null;
  isLoading?: boolean;
}

export function LaunchOverviewDialog({
  open,
  onOpenChange,
  onConfirm,
  formValues,
  imagePreview,
  isLoading = false,
}: LaunchOverviewDialogProps) {
  const totalCost =
    parseFloat(formValues.devBuyAmount || "0") +
    (formValues.bundleBuyEnabled
      ? parseInt(formValues.numberOfWallets || "0") *
        parseFloat(formValues.buyAmountPerWallet || "0")
      : 0) +
    parseFloat(formValues.jitoTipAmount || "0");

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
              <img
                src={imagePreview}
                alt="Token"
                className="h-16 w-16 rounded-xl object-cover"
              />
            ) : (
              <div className="h-16 w-16 rounded-xl bg-muted flex items-center justify-center">
                <ImagePlus className="h-6 w-6 text-muted-foreground" />
              </div>
            )}
            <div>
              <p className="text-lg font-semibold">
                {formValues.tokenName || "Token Name"}
              </p>
              <p className="text-sm text-muted-foreground">
                ${formValues.tokenSymbol || "SYMBOL"}
              </p>
            </div>
          </div>

          <div className="grid gap-3 text-sm">
            <div className="grid grid-cols-[140px_1fr] gap-2">
              <span className="text-muted-foreground">Description</span>
              <span className="text-foreground line-clamp-2">
                {formValues.description || "-"}
              </span>
            </div>
            {(formValues.twitter ||
              formValues.telegram ||
              formValues.website) && (
              <div className="grid grid-cols-[140px_1fr] gap-2">
                <span className="text-muted-foreground">Social Links</span>
                <div className="flex gap-2">
                  {formValues.twitter && (
                    <span className="text-xs bg-muted px-2 py-0.5 rounded">
                      Twitter
                    </span>
                  )}
                  {formValues.telegram && (
                    <span className="text-xs bg-muted px-2 py-0.5 rounded">
                      Telegram
                    </span>
                  )}
                  {formValues.website && (
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
                  {formValues.devWalletOption === "import"
                    ? "Imported wallet"
                    : formValues.devWalletOption === "generate"
                    ? "Will be generated"
                    : "Main wallet"}
                </span>
              </div>
              <div className="grid grid-cols-[140px_1fr] gap-2">
                <span className="text-muted-foreground">Dev Buy</span>
                <span>{formValues.devBuyAmount || "0"} SOL</span>
              </div>
              <div className="grid grid-cols-[140px_1fr] gap-2">
                <span className="text-muted-foreground">Jito Tip</span>
                <span>{formValues.jitoTipAmount || "0"} SOL</span>
              </div>
              {formValues.bundleBuyEnabled && (
                <>
                  <div className="grid grid-cols-[140px_1fr] gap-2">
                    <span className="text-muted-foreground">Bundle Buy</span>
                    <span>
                      {formValues.numberOfWallets} wallets ×{" "}
                      {formValues.buyAmountPerWallet} SOL (±
                      {formValues.buyAmountVariance}%)
                    </span>
                  </div>
                  {parseInt(formValues.distributionMultiplier) > 1 && (
                    <div className="grid grid-cols-[140px_1fr] gap-2">
                      <span className="text-muted-foreground">
                        Distribution
                      </span>
                      <span>
                        {parseInt(formValues.numberOfWallets || "0") *
                          parseInt(
                            formValues.distributionMultiplier || "1"
                          )}{" "}
                        wallets after ×{formValues.distributionMultiplier}{" "}
                        distribution
                      </span>
                    </div>
                  )}
                </>
              )}
              {!formValues.bundleBuyEnabled && (
                <div className="grid grid-cols-[140px_1fr] gap-2">
                  <span className="text-muted-foreground">Bundle Buy</span>
                  <span>Disabled</span>
                </div>
              )}
              {formValues.vanityMint && (
                <div className="grid grid-cols-[140px_1fr] gap-2">
                  <span className="text-muted-foreground">Vanity Address</span>
                  <span className="text-green-600">Enabled</span>
                </div>
              )}
            </div>
          </div>

          <div className="border-t pt-4">
            <div className="flex justify-between items-center text-sm">
              <span className="font-medium">Total Cost</span>
              <span className="text-lg font-bold">
                {totalCost.toFixed(4)} SOL
              </span>
            </div>
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
          <Button onClick={onConfirm} disabled={isLoading}>
            {isLoading ? "Launching..." : "Confirm Launch"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
