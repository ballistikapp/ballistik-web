"use client";

import * as React from "react";
import {
  buildVersionedLaunchPreviewInput,
} from "@/components/launch/build-versioned-launch-payload";
import { getLaunchAttributionDescription } from "@/components/launch/launch-attribution";
import type { LaunchFunnelFormValues } from "@/components/launch/launch-funnel-form-values";
import { LaunchReviewSection } from "@/components/launch/shared/launch-review-section";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { trpc } from "@/lib/trpc/client";

interface LaunchOverviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  launchInput: LaunchFunnelFormValues;
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
  const previewInput = React.useMemo(
    () =>
      buildVersionedLaunchPreviewInput({
        platform: launchInput.platform,
        options: launchInput.options,
        config: launchInput.config,
      }),
    [launchInput.platform, launchInput.options, launchInput.config]
  );
  const previewCostsQuery = trpc.launch.previewCosts.useQuery(previewInput!, {
    enabled: open && Boolean(previewInput),
    refetchOnWindowFocus: false,
  });
  const preview = previewCostsQuery.data;
  const quoteLoading =
    previewCostsQuery.isLoading || previewCostsQuery.isFetching;
  const canConfirm =
    preview?.hasSufficientMainWallet === true && !quoteLoading && !isLoading;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] w-[min(90vw,900px)] max-w-none overflow-y-auto sm:max-w-none">
        <DialogHeader>
          <DialogTitle className="text-xl">Launch Overview</DialogTitle>
          <DialogDescription>
            Review your token details before launching
          </DialogDescription>
        </DialogHeader>
        <Separator />
        <LaunchReviewSection
          values={launchInput}
          preview={preview}
          previewLoading={quoteLoading}
          previewError={previewCostsQuery.error?.message ?? null}
          imagePreview={imagePreview}
          bannerPreview={bannerPreview}
          description={getLaunchAttributionDescription(
            launchInput.metadata.description,
            launchInput.options.removeAttribution
          )}
          showSubmitFooter={false}
        />
        {preview && !preview.hasSufficientMainWallet && (
          <p className="text-sm text-destructive">
            Main wallet is below the required start amount.
          </p>
        )}
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
