"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { LaunchOverviewDialog } from "@/app/(app)/launch/launch-overview-dialog";
import { LaunchProgressDialog } from "@/app/(app)/launch/launch-progress-dialog";
import {
  createDefaultLaunchFunnelFormValues,
  launchFunnelFormSchema,
  type LaunchFunnelFormValues,
} from "@/components/launch/launch-funnel-form-values";
import {
  buildVersionedLaunchInput,
  buildVersionedLaunchPreviewInput,
} from "@/components/launch/build-versioned-launch-payload";
import { PumpfunConfigFields } from "@/components/launch/platforms/pumpfun/pumpfun-config-fields";
import { mapFlatInitialToLaunchFunnelValues } from "@/components/launch/platforms/pumpfun/map-flat-initial-values";
import { LaunchReviewSection } from "@/components/launch/shared/launch-review-section";
import { PlatformSelector } from "@/components/launch/shared/platform-selector";
import { TokenMetadataFields } from "@/components/launch/shared/token-metadata-fields";
import { getLaunchAttributionDescription } from "@/components/launch/launch-attribution";
import {
  useLaunchFunnelForm,
  type FunnelFieldState,
} from "@/components/launch/use-launch-funnel-form";
import {
  PageSection,
  PageSectionDivider,
  PageSectionHeader,
} from "@/components/layout/sections";
import { trpc } from "@/lib/trpc/client";
import { invalidateTokenSidebarCounts } from "@/lib/trpc/invalidate-token-sidebar-counts";

const MAIN_IMAGE_MIME_TYPES = ["image/jpeg", "image/png", "image/gif"];
const MAIN_VIDEO_MIME_TYPES = ["video/mp4"];
const BANNER_IMAGE_MIME_TYPES = ["image/jpeg", "image/png", "image/gif"];
const MAIN_IMAGE_MAX_BYTES = 15 * 1024 * 1024;
const MAIN_VIDEO_MAX_BYTES = 30 * 1024 * 1024;
const BANNER_MAX_BYTES = Math.floor(4.3 * 1024 * 1024);

const readImageDimensions = (file: File) =>
  new Promise<{ width: number; height: number }>((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = document.createElement("img");
    image.onload = () => {
      resolve({ width: image.width, height: image.height });
      URL.revokeObjectURL(url);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Failed to read image dimensions"));
    };
    image.src = url;
  });

const readVideoDimensions = (file: File) =>
  new Promise<{ width: number; height: number }>((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    video.preload = "metadata";
    video.onloadedmetadata = () => {
      resolve({ width: video.videoWidth, height: video.videoHeight });
      URL.revokeObjectURL(url);
    };
    video.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Failed to read video metadata"));
    };
    video.src = url;
  });

type LaunchFunnelShellProps = {
  /** Nested funnel values, or a flat preset/clone bag (legacy page path). */
  initialValues?: LaunchFunnelFormValues | Record<string, unknown> | null;
};

function FunnelReview({
  values,
  imagePreview,
  bannerPreview,
}: {
  values: LaunchFunnelFormValues;
  imagePreview: string | null;
  bannerPreview: string | null;
}) {
  const previewInput = React.useMemo(
    () =>
      buildVersionedLaunchPreviewInput({
        platform: values.platform,
        config: values.config,
      }),
    [values.platform, values.config]
  );
  const previewCostsQuery = trpc.launch.previewCosts.useQuery(previewInput!, {
    enabled: Boolean(previewInput),
    refetchOnWindowFocus: false,
  });

  return (
    <LaunchReviewSection
      values={values}
      preview={previewCostsQuery.data}
      previewLoading={
        previewCostsQuery.isLoading || previewCostsQuery.isFetching
      }
      previewError={previewCostsQuery.error?.message ?? null}
      imagePreview={imagePreview}
      bannerPreview={bannerPreview}
      description={getLaunchAttributionDescription(
        values.metadata.description,
        values.config.removeAttribution
      )}
    />
  );
}

export function LaunchFunnelShell({
  initialValues,
}: LaunchFunnelShellProps) {
  const router = useRouter();
  const utils = trpc.useUtils();
  const [imagePreview, setImagePreview] = React.useState<string | null>(null);
  const [bannerPreview, setBannerPreview] = React.useState<string | null>(null);
  const [showLaunchDialog, setShowLaunchDialog] = React.useState(false);
  const [activeLaunchId, setActiveLaunchId] = React.useState<string | null>(
    null
  );
  const [isProgressOpen, setIsProgressOpen] = React.useState(false);
  const [launchNotified, setLaunchNotified] = React.useState(false);
  const mainMediaInputRef = React.useRef<HTMLInputElement>(null);
  const bannerInputRef = React.useRef<HTMLInputElement>(null);

  const defaultValues = React.useMemo(() => {
    if (
      initialValues &&
      typeof initialValues === "object" &&
      "platform" in initialValues &&
      "metadata" in initialValues &&
      "config" in initialValues
    ) {
      return initialValues as LaunchFunnelFormValues;
    }
    return mapFlatInitialToLaunchFunnelValues(
      initialValues as Record<string, unknown> | null | undefined,
      createDefaultLaunchFunnelFormValues()
    );
  }, [initialValues]);
  const form = useLaunchFunnelForm(defaultValues, () =>
    setShowLaunchDialog(true)
  );

  const startLaunchMutation = trpc.launch.start.useMutation({
    onSuccess: (data) => {
      toast.success("Launch started", {
        description: "Your token launch is now in progress.",
      });
      setShowLaunchDialog(false);
      setActiveLaunchId(data.launchId);
      setIsProgressOpen(true);
      setLaunchNotified(false);
      void utils.activeProcess.list.invalidate();
    },
    onError: (error) => {
      toast.error("Failed to start launch", {
        description: error.message || "Unable to start the launch.",
      });
    },
  });
  const cancelLaunchMutation = trpc.launch.cancel.useMutation({
    onSuccess: () => {
      toast.message("Cancel requested", {
        description: "The launch will stop as soon as it is safe.",
      });
    },
    onError: (error) => {
      toast.error("Failed to cancel launch", {
        description: error.message || "Unable to cancel the launch.",
      });
    },
  });
  const retryLaunchMutation = trpc.launch.retry.useMutation({
    onSuccess: (data) => {
      toast.message("Retry started", {
        description: "A new launch attempt has been queued.",
      });
      setActiveLaunchId(data.launchId);
      setIsProgressOpen(true);
      setLaunchNotified(false);
      void utils.activeProcess.list.invalidate();
      router.push("/launch");
    },
    onError: (error) => {
      toast.error("Failed to retry launch", {
        description: error.message || "Unable to start a retry attempt.",
      });
    },
  });

  const activeLaunchQuery = trpc.launch.getActive.useQuery();
  const refreshWalletBalancesMutation =
    trpc.wallet.refreshBalances.useMutation();
  const launchStatusQuery = trpc.launch.status.useQuery(
    { launchId: activeLaunchId ?? "" },
    {
      enabled: Boolean(activeLaunchId),
      refetchInterval: (query) => {
        const launch = query.state.data;
        if (!launch) return 2000;
        return launch.status === "PENDING" || launch.status === "RUNNING"
          ? 2000
          : false;
      },
    }
  );

  React.useEffect(() => {
    if (!activeLaunchId && activeLaunchQuery.data) {
      setActiveLaunchId(activeLaunchQuery.data.id);
      setIsProgressOpen(true);
    }
  }, [activeLaunchId, activeLaunchQuery.data]);

  React.useEffect(() => {
    const launch = launchStatusQuery.data;
    if (!launch) return;
    if (launch.status === "SUCCEEDED" && !launchNotified) {
      toast.success("Launch complete", {
        description: `Token ${launch.tokenPublicKey} is live.`,
      });
      setLaunchNotified(true);
      if (launch.tokenPublicKey) {
        void refreshWalletBalancesMutation
          .mutateAsync({
            tokenPublicKey: launch.tokenPublicKey,
            force: true,
          })
          .finally(() => {
            invalidateTokenSidebarCounts(utils, launch.tokenPublicKey);
          });
      }
      void utils.wallet.getMain.invalidate();
      router.refresh();
    }
    if (launch.status === "FAILED" && !launchNotified) {
      toast.error("Launch failed", {
        description:
          launch.errorMessage || "Something went wrong during launch.",
      });
      setLaunchNotified(true);
    }
    if (launch.status === "CANCELED" && !launchNotified) {
      toast.message("Launch canceled", {
        description: "The launch has been stopped.",
      });
      setLaunchNotified(true);
    }
  }, [
    launchNotified,
    launchStatusQuery.data,
    refreshWalletBalancesMutation,
    router,
    utils,
  ]);

  const values = form.state.values;
  const showSubmitErrors = form.state.submissionAttempts > 0;
  const getIsInvalid = (field: FunnelFieldState) =>
    (field.state.meta.isTouched || showSubmitErrors) &&
    field.state.meta.errors.length > 0;
  const revalidateAfterSubmitAttempt = () => {
    if (showSubmitErrors) {
      void form.validateAllFields("submit");
    }
  };
  const resetMainMediaInput = () => {
    if (mainMediaInputRef.current) mainMediaInputRef.current.value = "";
  };
  const resetBannerInput = () => {
    if (bannerInputRef.current) bannerInputRef.current.value = "";
  };

  const handleMainMediaUpload = async (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const isImage = MAIN_IMAGE_MIME_TYPES.includes(file.type);
    const isVideo = MAIN_VIDEO_MIME_TYPES.includes(file.type);
    if (!isImage && !isVideo) {
      toast.error("Unsupported file type", {
        description: "Upload a JPG, PNG, GIF, or MP4 file.",
      });
      resetMainMediaInput();
      return;
    }
    const maxBytes = isVideo ? MAIN_VIDEO_MAX_BYTES : MAIN_IMAGE_MAX_BYTES;
    if (file.size > maxBytes) {
      toast.error("File is too large", {
        description: isVideo
          ? "Videos must be 30MB or smaller."
          : "Images must be 15MB or smaller.",
      });
      resetMainMediaInput();
      return;
    }
    try {
      if (isImage) {
        const { width, height } = await readImageDimensions(file);
        if (Math.abs(width / height - 1) > 0.1) {
          toast.message("Image aspect ratio recommendation", {
            description: "A 1:1 square image is recommended.",
          });
        }
      } else {
        const { width, height } = await readVideoDimensions(file);
        const ratio = width / height;
        if (
          Math.abs(ratio - 16 / 9) > 0.1 &&
          Math.abs(ratio - 9 / 16) > 0.1
        ) {
          toast.message("Video aspect ratio recommendation", {
            description: "16:9 or 9:16 is recommended.",
          });
        }
        if (Math.max(width, height) < 1080) {
          toast.message("Video resolution recommendation", {
            description: "1080p or higher is recommended.",
          });
        }
      }
    } catch {
      toast.error("Unable to read media", {
        description: "Please try a different file.",
      });
      resetMainMediaInput();
      return;
    }
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result as string;
      setImagePreview(result);
      form.setFieldValue("metadata.tokenImage", result);
      revalidateAfterSubmitAttempt();
    };
    reader.onerror = resetMainMediaInput;
    reader.readAsDataURL(file);
  };

  const handleBannerUpload = async (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (
      !BANNER_IMAGE_MIME_TYPES.includes(file.type) ||
      file.size > BANNER_MAX_BYTES
    ) {
      toast.error("Invalid banner", {
        description: "Use a JPG, PNG, or GIF banner up to 4.3MB.",
      });
      resetBannerInput();
      return;
    }
    try {
      const { width, height } = await readImageDimensions(file);
      if (
        width < 1500 ||
        height < 500 ||
        Math.abs(width / height - 3) > 0.05
      ) {
        toast.error("Banner must be at least 1500x500px with a 3:1 ratio.");
        resetBannerInput();
        return;
      }
    } catch {
      toast.error("Unable to read banner dimensions.");
      resetBannerInput();
      return;
    }
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result as string;
      setBannerPreview(result);
      form.setFieldValue("metadata.tokenBanner", result);
      revalidateAfterSubmitAttempt();
    };
    reader.onerror = resetBannerInput;
    reader.readAsDataURL(file);
  };

  const handleConfirmLaunch = async () => {
    const validation = await launchFunnelFormSchema.safeParseAsync(
      form.state.values
    );
    if (!validation.success) {
      toast.error("Validation failed", {
        description: "Please check your form inputs.",
      });
      return;
    }
    const input = buildVersionedLaunchInput(validation.data);
    if (!input) {
      toast.error("This platform is not available yet.");
      return;
    }
    startLaunchMutation.mutate(input);
  };

  const currentLaunch =
    launchStatusQuery.data ?? activeLaunchQuery.data ?? null;

  return (
    <div className="space-y-6 pb-12">
      <form
        id="launch-form"
        onSubmit={(event) => {
          event.preventDefault();
          void form.validateAllFields("submit");
          void form.handleSubmit();
        }}
        className="space-y-0"
      >
        <PlatformSelector
          value={values.platform}
          onValueChange={(platform) => {
            if (platform === "PUMPFUN") {
              form.setFieldValue("platform", platform);
            }
          }}
        />
        <PageSectionDivider />

        <section id="token-details" className="scroll-mt-4">
          <PageSection>
            <TokenMetadataFields
              form={form}
              getIsInvalid={getIsInvalid}
              imagePreview={imagePreview}
              bannerPreview={bannerPreview}
              mainMediaInputRef={mainMediaInputRef}
              bannerInputRef={bannerInputRef}
              onMainMediaUpload={handleMainMediaUpload}
              onBannerUpload={handleBannerUpload}
              onRemoveMainMedia={() => {
                setImagePreview(null);
                form.setFieldValue("metadata.tokenImage", "");
                resetMainMediaInput();
                revalidateAfterSubmitAttempt();
              }}
              onRemoveBanner={() => {
                setBannerPreview(null);
                form.setFieldValue("metadata.tokenBanner", "");
                resetBannerInput();
                revalidateAfterSubmitAttempt();
              }}
            />
          </PageSection>
        </section>
        <PageSectionDivider />

        {values.platform === "PUMPFUN" && (
          <PumpfunConfigFields form={form} getIsInvalid={getIsInvalid} />
        )}
        <PageSectionDivider />

        <section id="review">
          <PageSection className="-mb-18">
            <PageSectionHeader title="Review" />
            <form.Subscribe selector={(state) => state.values}>
              {(reviewValues) => (
                <FunnelReview
                  values={reviewValues}
                  imagePreview={imagePreview}
                  bannerPreview={bannerPreview}
                />
              )}
            </form.Subscribe>
          </PageSection>
        </section>
      </form>

      <LaunchOverviewDialog
        open={showLaunchDialog}
        onOpenChange={setShowLaunchDialog}
        onConfirm={handleConfirmLaunch}
        launchInput={values}
        imagePreview={imagePreview}
        bannerPreview={bannerPreview}
        isLoading={startLaunchMutation.isPending}
      />
      <LaunchProgressDialog
        open={isProgressOpen}
        onOpenChange={setIsProgressOpen}
        launch={currentLaunch}
        onCancel={() => {
          if (activeLaunchId) {
            cancelLaunchMutation.mutate({ launchId: activeLaunchId });
          }
        }}
        onClose={() => {
          setIsProgressOpen(false);
          if (
            currentLaunch?.status === "SUCCEEDED" ||
            currentLaunch?.status === "FAILED" ||
            currentLaunch?.status === "CANCELED"
          ) {
            setActiveLaunchId(null);
          }
        }}
        onRetry={() => {
          if (currentLaunch) {
            retryLaunchMutation.mutate({ launchId: currentLaunch.id });
          }
        }}
        retryPending={retryLaunchMutation.isPending}
      />
    </div>
  );
}
