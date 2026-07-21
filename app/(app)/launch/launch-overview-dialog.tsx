"use client";

import * as React from "react";
import {
  buildVersionedLaunchPreviewInput,
} from "@/components/launch/build-versioned-launch-payload";
import type {
  PumpfunConfigFormValues,
  SharedTokenMetadataFormValues,
} from "@/components/launch/launch-funnel-form-values";
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
  launchInput: {
    metadata: SharedTokenMetadataFormValues;
    config: PumpfunConfigFormValues;
  };
  imagePreview: string | null;
  bannerPreview: string | null;
  isLoading?: boolean;
}

const LAUNCH_ATTRIBUTION_TEXT = "Launched with ballistik.app";

function getDescription(
  description: string,
  removeAttribution: boolean
): string {
  const trimmed = description.trim();
  if (removeAttribution) return trimmed || "-";
  return trimmed
    ? `${trimmed}\n\n${LAUNCH_ATTRIBUTION_TEXT}`
    : LAUNCH_ATTRIBUTION_TEXT;
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
        platform: "PUMPFUN",
        config: launchInput.config,
      }),
    [launchInput.config]
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
          values={{
            platform: "PUMPFUN",
            metadata: launchInput.metadata,
            config: launchInput.config,
          }}
          preview={preview}
          previewLoading={quoteLoading}
          previewError={previewCostsQuery.error?.message ?? null}
          imagePreview={imagePreview}
          bannerPreview={bannerPreview}
          description={getDescription(
            launchInput.metadata.description,
            launchInput.config.removeAttribution
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
