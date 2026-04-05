"use client";

import * as React from "react";
import { useForm } from "@tanstack/react-form";
import { toast } from "sonner";
import * as z from "zod";
import {
  ImagePlus,
  X,
  Info,
  Import,
  Sparkles,
  Wallet,
  ChevronRight,
  ChevronsUpDown,
  Shield,
  Lock,
} from "lucide-react";
import Image from "next/image";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandGroup,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  PageSection,
  PageSectionDivider,
  PageSectionHeader,
} from "@/components/layout/sections";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupText,
  InputGroupTextarea,
} from "@/components/ui/input-group";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import { LaunchOverviewDialog } from "@/app/(app)/launch/launch-overview-dialog";
import { LaunchProgressDialog } from "@/app/(app)/launch/launch-progress-dialog";
import { useRouter } from "next/navigation";
import { trpc } from "@/lib/trpc/client";
import {
  bundleBuyFeeSol,
  calculateLaunchUsageFees,
  descriptionAttributionRemovalFeeSol,
  discountLaunchUsageFees,
  waiveLaunchUsageFees,
  vanityMintFeeSol,
} from "@/lib/config/usage-fees.config";
import { DEVELOPER_FEE_DISCOUNT_RATE } from "@/lib/config/subscription.config";

const formSchema = z
  .object({
    tokenName: z
      .string()
      .min(1, "Token name is required")
      .max(32, "Token name must be at most 32 characters"),
    tokenSymbol: z
      .string()
      .min(1, "Token symbol is required")
      .max(10, "Token symbol must be at most 10 characters"),
    description: z
      .string()
      .max(500, "Description must be at most 500 characters"),
    tokenImage: z.string().min(1, "Main image or video is required"),
    tokenBanner: z.string(),
    twitter: z.string(),
    telegram: z.string(),
    website: z.string(),
    devWalletOption: z.enum(["system", "import", "generate", "use_main"]),
    importedDevWalletKey: z.string(),
    devBuyAmountSol: z
      .number()
      .positive("Dev buy amount must be greater than 0"),
    jitoTipAmountSol: z.number().min(0, "Jito tip amount must be 0 or more"),
    bundleBuyEnabled: z.boolean(),
    vanityMint: z.boolean(),
    removeAttribution: z.boolean(),
    bundlerWalletCount: z
      .number()
      .int()
      .min(0, "Bundler wallet count must be 0 or more")
      .max(10, "Bundler wallet count must be 10 or less"),
    bundlerBuyAmountSol: z
      .number()
      .min(0.1, "Buy amount per wallet must be at least 0.1 SOL"),
    bundlerBuyVariancePercent: z
      .number()
      .min(0, "Bundler buy variance must be 0 or more")
      .max(50, "Bundler buy variance must be 50 or less"),
    distributionWalletMultiplier: z
      .number()
      .int()
      .min(1, "Distribution multiplier must be at least 1")
      .max(5, "Distribution multiplier must be 5 or less"),
  })
  .superRefine((values, ctx) => {
    if (
      values.devWalletOption === "import" &&
      !values.importedDevWalletKey.trim()
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["importedDevWalletKey"],
        message: "Dev wallet private key is required",
      });
    }
  });

const MAIN_IMAGE_MIME_TYPES = ["image/jpeg", "image/png", "image/gif"];
const MAIN_VIDEO_MIME_TYPES = ["video/mp4"];
const BANNER_IMAGE_MIME_TYPES = ["image/jpeg", "image/png", "image/gif"];
const MAIN_IMAGE_MAX_BYTES = 15 * 1024 * 1024;
const MAIN_VIDEO_MAX_BYTES = 30 * 1024 * 1024;
const BANNER_MAX_BYTES = Math.floor(4.3 * 1024 * 1024);
const BANNER_MIN_WIDTH = 1500;
const BANNER_MIN_HEIGHT = 500;
const BANNER_ASPECT_RATIO = 3;
const BANNER_ASPECT_TOLERANCE = 0.05;
const MAIN_IMAGE_ASPECT_TOLERANCE = 0.1;
const VIDEO_ASPECT_TOLERANCE = 0.1;
const VIDEO_RECOMMENDED_MIN = 1080;
const LAUNCH_ATTRIBUTION_TEXT = "Launched with ballistik.app";

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

function calculateLaunchTotals(values: {
  devWalletOption: "system" | "import" | "generate" | "use_main";
  devBuyAmountSol: number;
  jitoTipAmountSol: number;
  bundleBuyEnabled: boolean;
  bundlerWalletCount: number;
  bundlerBuyAmountSol: number;
  vanityMint: boolean;
  removeAttribution: boolean;
  distributionWalletMultiplier: number;
  platformFeeDiscountRate?: number;
}) {
  const bundleBuyTotal = values.bundleBuyEnabled
    ? values.bundlerWalletCount * values.bundlerBuyAmountSol
    : 0;
  const effectiveJitoTipSol = values.bundleBuyEnabled
    ? values.jitoTipAmountSol
    : 0;
  const rawFees = calculateLaunchUsageFees({
    devWalletOption: values.devWalletOption,
    bundleBuyEnabled: values.bundleBuyEnabled,
    bundlerWalletCount: values.bundlerWalletCount,
    distributionWalletMultiplier: values.distributionWalletMultiplier,
    vanityMint: values.vanityMint,
    removeAttribution: values.removeAttribution,
  });
  const dr = values.platformFeeDiscountRate ?? 0;
  const usageFees =
    dr >= 1
      ? waiveLaunchUsageFees(rawFees)
      : dr > 0
        ? discountLaunchUsageFees(rawFees, dr)
        : rawFees;
  const totalCostSol =
    values.devBuyAmountSol +
    bundleBuyTotal +
    effectiveJitoTipSol +
    usageFees.totalFeeSol;
  const distributionWallets =
    values.bundlerWalletCount * values.distributionWalletMultiplier;

  return { bundleBuyTotal, totalCostSol, distributionWallets, usageFees };
}

function getReviewDescription(
  description: string,
  removeAttribution: boolean
): string {
  const baseDescription = description.trim();
  if (removeAttribution) {
    return baseDescription || "-";
  }
  if (!baseDescription) {
    return LAUNCH_ATTRIBUTION_TEXT;
  }
  return `${baseDescription}\n\n${LAUNCH_ATTRIBUTION_TEXT}`;
}

type LaunchFormProps = {
  initialValues?: Record<string, unknown> | null;
};

export function LaunchForm({ initialValues }: LaunchFormProps) {
  const router = useRouter();
  const utils = trpc.useUtils();
  const { data: currentUser } = trpc.auth.me.useQuery();
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

  const startLaunchMutation = trpc.launch.start.useMutation({
    onSuccess: (data) => {
      toast.success("Launch started", {
        description: "Your token launch is now in progress.",
      });
      setShowLaunchDialog(false);
      setActiveLaunchId(data.launchId);
      setIsProgressOpen(true);
      setLaunchNotified(false);
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
    if (!launch) {
      return;
    }

    if (launch.status === "SUCCEEDED" && !launchNotified) {
      toast.success("Launch complete", {
        description: `Token ${launch.tokenPublicKey} is live.`,
      });
      setLaunchNotified(true);
      if (launch.tokenPublicKey) {
        void refreshWalletBalancesMutation.mutateAsync({
          tokenPublicKey: launch.tokenPublicKey,
          force: true,
        });
      }
      utils.wallet.getMain.invalidate();
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

    if (launch.status !== "PENDING" && launch.status !== "RUNNING") {
      // Keep terminal launch data in-memory so the dialog can show final logs/status.
      // It will still not auto-resume on refresh because we no longer persist launch id.
    }
  }, [
    launchNotified,
    launchStatusQuery.data,
    refreshWalletBalancesMutation,
    router,
    utils.wallet.getMain,
  ]);

  const clearActiveLaunch = React.useCallback(() => {
    setActiveLaunchId(null);
  }, []);

  const launchStatus =
    launchStatusQuery.data?.status ?? activeLaunchQuery.data?.status;
  const resetMainMediaInput = () => {
    if (mainMediaInputRef.current) {
      mainMediaInputRef.current.value = "";
    }
  };

  const resetBannerInput = () => {
    if (bannerInputRef.current) {
      bannerInputRef.current.value = "";
    }
  };

  const handleMainMediaUpload = async (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = e.target.files?.[0];
    if (!file) {
      return;
    }
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
    if (isImage) {
      try {
        const { width, height } = await readImageDimensions(file);
        const ratio = width / height;
        if (Math.abs(ratio - 1) > MAIN_IMAGE_ASPECT_TOLERANCE) {
          toast.message("Image aspect ratio recommendation", {
            description: "A 1:1 square image is recommended.",
          });
        }
      } catch (error) {
        toast.error("Unable to read image dimensions", {
          description: "Please try a different image file.",
        });
        resetMainMediaInput();
        return;
      }
    }
    if (isVideo) {
      try {
        const { width, height } = await readVideoDimensions(file);
        const ratio = width / height;
        const isWide = Math.abs(ratio - 16 / 9) <= VIDEO_ASPECT_TOLERANCE;
        const isTall = Math.abs(ratio - 9 / 16) <= VIDEO_ASPECT_TOLERANCE;
        if (!isWide && !isTall) {
          toast.message("Video aspect ratio recommendation", {
            description: "16:9 or 9:16 is recommended.",
          });
        }
        if (Math.max(width, height) < VIDEO_RECOMMENDED_MIN) {
          toast.message("Video resolution recommendation", {
            description: "1080p or higher is recommended.",
          });
        }
      } catch (error) {
        toast.error("Unable to read video metadata", {
          description: "Please try a different MP4 file.",
        });
        resetMainMediaInput();
        return;
      }
    }
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result as string;
      setImagePreview(result);
      form.setFieldValue("tokenImage", result);
      revalidateAfterSubmitAttempt();
    };
    reader.onerror = () => {
      toast.error("Failed to read file", {
        description: "Please try again.",
      });
      resetMainMediaInput();
    };
    reader.readAsDataURL(file);
  };

  const handleBannerUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) {
      return;
    }
    if (!BANNER_IMAGE_MIME_TYPES.includes(file.type)) {
      toast.error("Unsupported banner type", {
        description: "Upload a JPG, PNG, or GIF banner.",
      });
      resetBannerInput();
      return;
    }
    if (file.size > BANNER_MAX_BYTES) {
      toast.error("Banner file is too large", {
        description: "Banners must be 4.3MB or smaller.",
      });
      resetBannerInput();
      return;
    }
    try {
      const { width, height } = await readImageDimensions(file);
      if (width < BANNER_MIN_WIDTH || height < BANNER_MIN_HEIGHT) {
        toast.error("Banner is too small", {
          description: "Banners must be at least 1500x500px.",
        });
        resetBannerInput();
        return;
      }
      const ratio = width / height;
      if (Math.abs(ratio - BANNER_ASPECT_RATIO) > BANNER_ASPECT_TOLERANCE) {
        toast.error("Banner aspect ratio must be 3:1", {
          description: "Use a 1500x500px banner for best results.",
        });
        resetBannerInput();
        return;
      }
    } catch (error) {
      toast.error("Unable to read banner dimensions", {
        description: "Please try a different banner file.",
      });
      resetBannerInput();
      return;
    }
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result as string;
      setBannerPreview(result);
      form.setFieldValue("tokenBanner", result);
      revalidateAfterSubmitAttempt();
    };
    reader.onerror = () => {
      toast.error("Failed to read banner file", {
        description: "Please try again.",
      });
      resetBannerInput();
    };
    reader.readAsDataURL(file);
  };

  const removeMainMedia = () => {
    setImagePreview(null);
    form.setFieldValue("tokenImage", "");
    resetMainMediaInput();
    revalidateAfterSubmitAttempt();
  };

  const removeBanner = () => {
    setBannerPreview(null);
    form.setFieldValue("tokenBanner", "");
    resetBannerInput();
    revalidateAfterSubmitAttempt();
  };

  const defaults = {
    tokenName: "",
    tokenSymbol: "",
    description: "",
    tokenImage: "",
    tokenBanner: "",
    twitter: "",
    telegram: "",
    website: "",
    devWalletOption: "system" as "system" | "import" | "generate" | "use_main",
    importedDevWalletKey: "",
    devBuyAmountSol: 0.5,
    jitoTipAmountSol: 0.001,
    bundleBuyEnabled: true,
    vanityMint: true,
    removeAttribution: false,
    bundlerWalletCount: 10,
    bundlerBuyAmountSol: 0.1,
    bundlerBuyVariancePercent: 20,
    distributionWalletMultiplier: 1,
  };

  const mergedDefaults = React.useMemo(() => {
    if (!initialValues) return defaults;
    const clone = { ...defaults };
    for (const key of Object.keys(clone) as (keyof typeof clone)[]) {
      if (key === "tokenImage" || key === "tokenBanner") continue;
      if (key in initialValues && initialValues[key] != null) {
        (clone as Record<string, unknown>)[key] = initialValues[key];
      }
    }
    return clone;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialValues]);

  const form = useForm({
    defaultValues: mergedDefaults,
    validators: {
      onSubmit: formSchema,
    },
    onSubmit: async ({ value }) => {
      const validation = await formSchema.safeParseAsync(value);
      if (!validation.success) {
        const firstError = validation.error.errors[0];
        toast.error("Validation failed", {
          description: firstError?.message || "Please check your form inputs.",
        });
        return;
      }
      setShowLaunchDialog(true);
    },
  });

  const isVideoPreview = Boolean(imagePreview?.startsWith("data:video"));
  const showSubmitErrors = form.state.submissionAttempts > 0;
  const getIsInvalid = (field: {
    state: {
      meta: {
        isTouched: boolean;
        errors: Array<{ message?: string } | undefined>;
      };
    };
  }) =>
    (field.state.meta.isTouched || showSubmitErrors) &&
    field.state.meta.errors.length > 0;
  const revalidateAfterSubmitAttempt = () => {
    if (showSubmitErrors) {
      form.validateAllFields("submit");
    }
  };

  const handleConfirmLaunch = async () => {
    const values = form.state.values;
    const validation = await formSchema.safeParseAsync(values);
    if (!validation.success) {
      toast.error("Validation failed", {
        description: "Please check your form inputs.",
      });
      return;
    }
    startLaunchMutation.mutate({
      tokenName: values.tokenName,
      tokenSymbol: values.tokenSymbol,
      description: values.description || undefined,
      tokenImage: values.tokenImage,
      tokenBanner: values.tokenBanner,
      twitter: values.twitter || undefined,
      telegram: values.telegram || undefined,
      website: values.website || undefined,
      devWalletOption: values.devWalletOption,
      importedDevWalletKey: values.importedDevWalletKey || undefined,
      devBuyAmountSol: values.devBuyAmountSol,
      jitoTipAmountSol: values.jitoTipAmountSol,
      bundleBuyEnabled: values.bundleBuyEnabled,
      vanityMint: values.vanityMint,
      removeAttribution: values.removeAttribution,
      bundlerWalletCount: values.bundlerWalletCount,
      bundlerBuyAmountSol: values.bundlerBuyAmountSol,
      bundlerBuyVariancePercent: values.bundlerBuyVariancePercent,
      distributionWalletMultiplier: values.distributionWalletMultiplier,
    });
  };
  const previewInput = React.useMemo(
    () => ({
      devWalletOption: form.state.values.devWalletOption,
      importedDevWalletKey:
        form.state.values.devWalletOption === "import"
          ? form.state.values.importedDevWalletKey
          : undefined,
      devBuyAmountSol: form.state.values.devBuyAmountSol,
      jitoTipAmountSol: form.state.values.jitoTipAmountSol,
      bundleBuyEnabled: form.state.values.bundleBuyEnabled,
      vanityMint: form.state.values.vanityMint,
      removeAttribution: form.state.values.removeAttribution,
      bundlerWalletCount: form.state.values.bundlerWalletCount,
      bundlerBuyAmountSol: form.state.values.bundlerBuyAmountSol,
      bundlerBuyVariancePercent: form.state.values.bundlerBuyVariancePercent,
      distributionWalletMultiplier:
        form.state.values.distributionWalletMultiplier,
    }),
    [form.state.values]
  );
  const previewCostsQuery = trpc.launch.previewCosts.useQuery(previewInput, {
    refetchOnWindowFocus: false,
  });
  const preview = previewCostsQuery.data;

  return (
    <div className="space-y-6 pb-12">
      <form
        id="launch-form"
        onSubmit={(e) => {
          e.preventDefault();
          form.validateAllFields("submit");
          void form.handleSubmit();
        }}
        className="space-y-0"
      >
        {/* Platform Selector */}
        <section
          id="platform"
          className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
        >
          <h2 className="text-xl font-normal md:text-2xl">Platform</h2>
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                role="combobox"
                className="w-full justify-between sm:w-72"
              >
                <span className="flex items-center gap-2.5">
                  <Image
                    src="/logos/pumpfun.svg"
                    alt="pump.fun"
                    width={20}
                    height={20}
                    className="size-5"
                  />
                  <span>pump.fun</span>
                </span>
                <ChevronsUpDown className="size-4 shrink-0 opacity-50" />
              </Button>
            </PopoverTrigger>
            <PopoverContent
              className="w-(--radix-popover-trigger-width) p-0"
              align="start"
            >
              <Command>
                <CommandList>
                  <CommandGroup>
                    <CommandItem value="pumpfun" data-checked="true">
                      <Image
                        src="/logos/pumpfun.svg"
                        alt="pump.fun"
                        width={20}
                        height={20}
                        className="size-5"
                      />
                      pump.fun
                    </CommandItem>
                    <CommandItem value="spl" disabled>
                      <Image
                        src="/logos/solana.svg"
                        alt="Solana"
                        width={20}
                        height={20}
                        className="size-5 opacity-40"
                      />
                      <span className="opacity-60">SPL</span>
                      <span className="ml-auto rounded-full border border-border bg-muted px-2 py-px text-[10px] font-medium text-muted-foreground">
                        Soon
                      </span>
                    </CommandItem>
                    <CommandItem value="evm" disabled>
                      <Image
                        src="/logos/ethereum.svg"
                        alt="Ethereum"
                        width={20}
                        height={20}
                        className="size-5 opacity-40"
                      />
                      <span className="opacity-60">EVM</span>
                      <span className="ml-auto rounded-full border border-border bg-muted px-2 py-px text-[10px] font-medium text-muted-foreground">
                        Soon
                      </span>
                    </CommandItem>
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
        </section>

        <PageSectionDivider />

        {/* Step 1: Token Details */}
        <section id="token-details" className="scroll-mt-4">
          <PageSection>
            <div>
              <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-2 lg:gap-8">
                <div className="space-y-4">
                  <form.Field name="tokenName">
                    {(field) => {
                      const isInvalid = getIsInvalid(field);
                      return (
                        <Field data-invalid={isInvalid}>
                          <FieldLabel htmlFor={field.name}>
                            Token Name
                          </FieldLabel>
                          <Input
                            id={field.name}
                            name={field.name}
                            value={field.state.value}
                            onBlur={field.handleBlur}
                            onChange={(e) => field.handleChange(e.target.value)}
                            aria-invalid={isInvalid}
                            placeholder="My Token"
                            autoComplete="off"
                          />
                          {isInvalid && (
                            <FieldError errors={field.state.meta.errors} />
                          )}
                        </Field>
                      );
                    }}
                  </form.Field>
                  <form.Field name="tokenSymbol">
                    {(field) => {
                      const isInvalid = getIsInvalid(field);
                      return (
                        <Field data-invalid={isInvalid}>
                          <FieldLabel htmlFor={field.name}>
                            Token Symbol
                          </FieldLabel>
                          <Input
                            id={field.name}
                            name={field.name}
                            value={field.state.value}
                            onBlur={field.handleBlur}
                            onChange={(e) =>
                              field.handleChange(e.target.value.toUpperCase())
                            }
                            aria-invalid={isInvalid}
                            placeholder="MTK"
                            autoComplete="off"
                          />
                          {isInvalid && (
                            <FieldError errors={field.state.meta.errors} />
                          )}
                        </Field>
                      );
                    }}
                  </form.Field>
                  <div className="flex items-center space-x-3 pt-1">
                    <form.Field name="vanityMint">
                      {(field) => (
                        <Switch
                          id="vanity-mint"
                          checked={field.state.value}
                          onCheckedChange={field.handleChange}
                        />
                      )}
                    </form.Field>
                    <div className="flex items-center gap-2">
                      <Label htmlFor="vanity-mint">Vanity Token Address</Label>
                      <Tooltip>
                        <TooltipTrigger>
                          <Info className="h-4 w-4 text-muted-foreground" />
                        </TooltipTrigger>
                        <TooltipContent>
                          Generate a custom token address ending with
                          &quot;pump&quot;
                        </TooltipContent>
                      </Tooltip>
                    </div>
                  </div>
                  <form.Field name="description">
                    {(field) => {
                      const isInvalid = getIsInvalid(field);
                      return (
                        <Field data-invalid={isInvalid}>
                          <FieldLabel htmlFor={field.name}>
                            Description
                          </FieldLabel>
                          <InputGroup>
                            <InputGroupTextarea
                              id={field.name}
                              name={field.name}
                              value={field.state.value}
                              onBlur={field.handleBlur}
                              onChange={(e) =>
                                field.handleChange(e.target.value)
                              }
                              placeholder="Describe your token and its purpose..."
                              rows={4}
                              className="min-h-24 resize-none"
                              aria-invalid={isInvalid}
                            />
                            <InputGroupAddon align="block-end">
                              <InputGroupText className="tabular-nums">
                                {field.state.value.length}/500 characters
                              </InputGroupText>
                            </InputGroupAddon>
                          </InputGroup>
                          {isInvalid && (
                            <FieldError errors={field.state.meta.errors} />
                          )}
                        </Field>
                      );
                    }}
                  </form.Field>
                  <div className="flex items-center space-x-3 pt-1">
                    <form.Field name="removeAttribution">
                      {(field) => (
                        <Switch
                          id="remove-attribution"
                          checked={field.state.value}
                          onCheckedChange={field.handleChange}
                        />
                      )}
                    </form.Field>
                    <div className="flex items-center gap-2">
                      <Label htmlFor="remove-attribution">
                        Remove Ballistik attribution (+0.1 SOL)
                      </Label>
                      <Tooltip>
                        <TooltipTrigger>
                          <Info className="h-4 w-4 text-muted-foreground" />
                        </TooltipTrigger>
                        <TooltipContent>
                          By default, token descriptions include &quot;Launched
                          with ballistik.app&quot; at the end. Enable this to
                          remove that attribution for +0.1 SOL.
                        </TooltipContent>
                      </Tooltip>
                    </div>
                  </div>
                </div>
                <div className="space-y-6">
                  <form.Field name="tokenImage">
                    {(field) => {
                      const isInvalid = getIsInvalid(field);
                      return (
                        <Field data-invalid={isInvalid}>
                          <FieldLabel>Main Image</FieldLabel>
                          <div className="flex items-start gap-4">
                            <div
                              className={cn(
                                "relative flex h-24 w-24 shrink-0 items-center justify-center rounded-xl border-2 border-dashed transition-colors",
                                imagePreview
                                  ? "border-transparent"
                                  : "border-muted-foreground/25 hover:border-muted-foreground/50",
                                isInvalid &&
                                  !imagePreview &&
                                  "border-destructive hover:border-destructive"
                              )}
                            >
                              {imagePreview ? (
                                <>
                                  {isVideoPreview ? (
                                    <video
                                      src={imagePreview}
                                      className="h-full w-full rounded-xl object-cover"
                                      muted
                                      loop
                                      playsInline
                                      autoPlay
                                    />
                                  ) : (
                                    <img
                                      src={imagePreview}
                                      alt="Main media preview"
                                      className="h-full w-full rounded-xl object-cover"
                                    />
                                  )}
                                  <button
                                    type="button"
                                    onClick={removeMainMedia}
                                    className="absolute -right-2 -top-2 flex h-6 w-6 items-center justify-center rounded-full bg-destructive text-destructive-foreground shadow-sm hover:bg-destructive/90"
                                  >
                                    <X className="h-3.5 w-3.5" />
                                  </button>
                                </>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() =>
                                    mainMediaInputRef.current?.click()
                                  }
                                  className="flex h-full w-full flex-col items-center justify-center gap-1 text-muted-foreground hover:text-foreground"
                                  aria-invalid={isInvalid}
                                >
                                  <ImagePlus className="h-6 w-6" />
                                  <span className="text-xs">Upload</span>
                                </button>
                              )}
                            </div>
                            <input
                              ref={mainMediaInputRef}
                              type="file"
                              accept="image/png, image/jpeg, image/gif, video/mp4"
                              onChange={handleMainMediaUpload}
                              className="hidden"
                            />
                            <div className="space-y-1 text-sm text-muted-foreground">
                              <p className="font-medium text-foreground">
                                File size and type
                              </p>
                              <p>
                                Image - max 15MB. &quot;.jpg&quot;,
                                &quot;.gif&quot; or &quot;.png&quot; recommended
                              </p>
                              <p>
                                Video - max 30MB. &quot;.mp4&quot; recommended
                              </p>
                              <p className="pt-2 font-medium text-foreground">
                                Resolution and aspect ratio
                              </p>
                              <p>
                                Image - 1:1 square recommended (1000x1000px+)
                              </p>
                              <p>Video - 16:9 or 9:16, 1080p+ recommended</p>
                              {isInvalid && (
                                <FieldError errors={field.state.meta.errors} />
                              )}
                            </div>
                          </div>
                        </Field>
                      );
                    }}
                  </form.Field>
                  <div className="pt-2">
                    <p className="text-sm font-medium mb-3">Social Links</p>
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
                      <form.Field name="twitter">
                        {(field) => {
                          const isInvalid = getIsInvalid(field);
                          return (
                            <Field data-invalid={isInvalid}>
                              <FieldLabel htmlFor={field.name}>
                                Twitter/X
                              </FieldLabel>
                              <Input
                                id={field.name}
                                name={field.name}
                                value={field.state.value}
                                onBlur={field.handleBlur}
                                onChange={(e) =>
                                  field.handleChange(e.target.value)
                                }
                                aria-invalid={isInvalid}
                                placeholder="https://twitter.com/yourtoken"
                                autoComplete="off"
                              />
                              {isInvalid && (
                                <FieldError errors={field.state.meta.errors} />
                              )}
                            </Field>
                          );
                        }}
                      </form.Field>
                      <form.Field name="telegram">
                        {(field) => {
                          const isInvalid = getIsInvalid(field);
                          return (
                            <Field data-invalid={isInvalid}>
                              <FieldLabel htmlFor={field.name}>
                                Telegram
                              </FieldLabel>
                              <Input
                                id={field.name}
                                name={field.name}
                                value={field.state.value}
                                onBlur={field.handleBlur}
                                onChange={(e) =>
                                  field.handleChange(e.target.value)
                                }
                                aria-invalid={isInvalid}
                                placeholder="https://t.me/yourtoken"
                                autoComplete="off"
                              />
                              {isInvalid && (
                                <FieldError errors={field.state.meta.errors} />
                              )}
                            </Field>
                          );
                        }}
                      </form.Field>
                      <form.Field name="website">
                        {(field) => {
                          const isInvalid = getIsInvalid(field);
                          return (
                            <Field data-invalid={isInvalid}>
                              <FieldLabel htmlFor={field.name}>
                                Website
                              </FieldLabel>
                              <Input
                                id={field.name}
                                name={field.name}
                                value={field.state.value}
                                onBlur={field.handleBlur}
                                onChange={(e) =>
                                  field.handleChange(e.target.value)
                                }
                                aria-invalid={isInvalid}
                                placeholder="https://yourtoken.com"
                                autoComplete="off"
                              />
                              {isInvalid && (
                                <FieldError errors={field.state.meta.errors} />
                              )}
                            </Field>
                          );
                        }}
                      </form.Field>
                    </div>
                  </div>
                  {/* <Field>
                    <FieldLabel>Banner</FieldLabel>
                    <div className="flex items-start gap-4">
                    <div
                      className={cn(
                        "relative flex h-24 w-72 shrink-0 items-center justify-center rounded-xl border-2 border-dashed transition-colors",
                        bannerPreview
                          ? "border-transparent"
                          : "border-muted-foreground/25 hover:border-muted-foreground/50"
                      )}
                    >
                      {bannerPreview ? (
                        <>
                          <img
                            src={bannerPreview}
                            alt="Banner preview"
                            className="h-full w-full rounded-xl object-cover"
                          />
                          <button
                            type="button"
                            onClick={removeBanner}
                            className="absolute -right-2 -top-2 flex h-6 w-6 items-center justify-center rounded-full bg-destructive text-destructive-foreground shadow-sm hover:bg-destructive/90"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          onClick={() => bannerInputRef.current?.click()}
                          className="flex h-full w-full flex-col items-center justify-center gap-1 text-muted-foreground hover:text-foreground"
                        >
                          <ImagePlus className="h-6 w-6" />
                          <span className="text-xs">Upload</span>
                        </button>
                      )}
                    </div>
                    <input
                      ref={bannerInputRef}
                      type="file"
                      accept="image/png, image/jpeg, image/gif"
                      onChange={handleBannerUpload}
                      className="hidden"
                    />
                    <div className="text-sm text-muted-foreground space-y-1">
                      <p>
                        This will be shown on the coin page in addition to the
                        coin image.
                      </p>
                      <p>
                        Only available on creation and cannot be changed later.
                      </p>
                      <p className="pt-2 font-medium text-foreground">
                        File size and type
                      </p>
                      <p>
                        Image - max 4.3MB. &quot;.jpg&quot;, &quot;.gif&quot; or
                        &quot;.png&quot; recommended
                      </p>
                      <p className="pt-2 font-medium text-foreground">
                        Resolution and aspect ratio
                      </p>
                      <p>3:1 aspect ratio, 1500x500px recommended</p>
                    </div>
                    </div>
                  </Field> */}
                </div>
              </div>
            </div>
          </PageSection>
        </section>
        <PageSectionDivider />

        {/* Step 2: Dev Wallet Settings */}
        <section id="launch-settings" className="scroll-mt-4">
          <PageSection>
            <PageSectionHeader title="Dev Wallet Settings" />
            <div className="space-y-6">
              <Field>
                <div className="flex items-center gap-2 mb-1">
                  <FieldLabel>Dev Wallet</FieldLabel>
                  <Tooltip>
                    <TooltipTrigger>
                      <Info className="h-4 w-4 text-muted-foreground" />
                    </TooltipTrigger>
                    <TooltipContent>
                      Wallet that owns the token and will make the dev buy
                    </TooltipContent>
                  </Tooltip>
                </div>
                <form.Field name="devWalletOption">
                  {(field) => {
                    const canSelectDevWallet =
                      currentUser?.plan === "PRO" ||
                      currentUser?.plan === "DEVELOPER";
                    const lockedClass = !canSelectDevWallet
                      ? "opacity-50 cursor-not-allowed"
                      : "";
                    const upgradeTooltip =
                      "Upgrade to Developer or Pro plan to use Import, Generate, or Main Wallet options.";
                    return (
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => field.handleChange("system")}
                          className={cn(
                            "flex items-center gap-2 px-3 py-2 rounded-md border transition-all text-sm",
                            field.state.value === "system"
                              ? "border-primary bg-primary/5 font-medium"
                              : "border-muted hover:border-muted-foreground/50"
                          )}
                        >
                          <Shield className="h-4 w-4" />
                          System Wallet
                        </button>
                        {canSelectDevWallet ? (
                          <button
                            type="button"
                            onClick={() => field.handleChange("import")}
                            className={cn(
                              "flex items-center gap-2 px-3 py-2 rounded-md border transition-all text-sm",
                              field.state.value === "import"
                                ? "border-primary bg-primary/5 font-medium"
                                : "border-muted hover:border-muted-foreground/50"
                            )}
                          >
                            <Import className="h-4 w-4" />
                            Import
                          </button>
                        ) : (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="relative inline-flex">
                                <button
                                  type="button"
                                  disabled
                                  className={cn(
                                    "flex items-center gap-2 px-3 py-2 rounded-md border transition-all text-sm",
                                    field.state.value === "import"
                                      ? "border-primary bg-primary/5 font-medium"
                                      : "border-muted",
                                    lockedClass
                                  )}
                                >
                                  <Import className="h-4 w-4" />
                                  Import
                                </button>
                                <Badge
                                  variant="secondary"
                                  className="opacity-70 pointer-events-none absolute left-1/2 -top-4 h-5 -translate-x-1/2 border border-border/60 bg-secondary/70 px-1.5 text-[10px] uppercase tracking-wide shadow-sm"
                                >
                                  <Lock className="h-2 w-2" />
                                  PAID
                                </Badge>
                              </span>
                            </TooltipTrigger>
                            <TooltipContent side="top">
                              {upgradeTooltip}
                            </TooltipContent>
                          </Tooltip>
                        )}
                        {canSelectDevWallet ? (
                          <button
                            type="button"
                            onClick={() => field.handleChange("generate")}
                            className={cn(
                              "flex items-center gap-2 px-3 py-2 rounded-md border transition-all text-sm",
                              field.state.value === "generate"
                                ? "border-primary bg-primary/5 font-medium"
                                : "border-muted hover:border-muted-foreground/50"
                            )}
                          >
                            <Sparkles className="h-4 w-4" />
                            Generate
                          </button>
                        ) : (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="relative inline-flex">
                                <button
                                  type="button"
                                  disabled
                                  className={cn(
                                    "flex items-center gap-2 px-3 py-2 rounded-md border transition-all text-sm",
                                    field.state.value === "generate"
                                      ? "border-primary bg-primary/5 font-medium"
                                      : "border-muted",
                                    lockedClass
                                  )}
                                >
                                  <Sparkles className="h-4 w-4" />
                                  Generate
                                </button>
                                <Badge
                                  variant="secondary"
                                  className="opacity-70 pointer-events-none absolute left-1/2 -top-4 h-5 -translate-x-1/2 border border-border/60 bg-secondary/70 px-1.5 text-[10px] uppercase tracking-wide shadow-sm"
                                >
                                  <Lock className="h-2 w-2" />
                                  PAID
                                </Badge>
                              </span>
                            </TooltipTrigger>
                            <TooltipContent side="top">
                              {upgradeTooltip}
                            </TooltipContent>
                          </Tooltip>
                        )}
                        {canSelectDevWallet ? (
                          <button
                            type="button"
                            onClick={() => field.handleChange("use_main")}
                            className={cn(
                              "flex items-center gap-2 px-3 py-2 rounded-md border transition-all text-sm",
                              field.state.value === "use_main"
                                ? "border-primary bg-primary/5 font-medium"
                                : "border-muted hover:border-muted-foreground/50"
                            )}
                          >
                            <Wallet className="h-4 w-4" />
                            Main Wallet
                          </button>
                        ) : (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="relative inline-flex">
                                <button
                                  type="button"
                                  disabled
                                  className={cn(
                                    "flex items-center gap-2 px-3 py-2 rounded-md border transition-all text-sm",
                                    field.state.value === "use_main"
                                      ? "border-primary bg-primary/5 font-medium"
                                      : "border-muted",
                                    lockedClass
                                  )}
                                >
                                  <Wallet className="h-4 w-4" />
                                  Main Wallet
                                </button>
                                <Badge
                                  variant="secondary"
                                  className="opacity-70 pointer-events-none absolute left-1/2 -top-4 h-5 -translate-x-1/2 border border-border/60 bg-secondary/70 px-1.5 text-[10px] uppercase tracking-wide shadow-sm"
                                >
                                  <Lock className="h-2 w-2" />
                                  PAID
                                </Badge>
                              </span>
                            </TooltipTrigger>
                            <TooltipContent side="top">
                              {upgradeTooltip}
                            </TooltipContent>
                          </Tooltip>
                        )}
                      </div>
                    );
                  }}
                </form.Field>
                <form.Subscribe
                  selector={(state) => state.values.devWalletOption}
                >
                  {(devWalletOption) => (
                    <div className="mt-2 h-9">
                      {devWalletOption === "system" && (
                        <p className="text-sm text-muted-foreground flex items-center h-full">
                          Platform-provided dev wallet will be used for this
                          launch
                        </p>
                      )}
                      {devWalletOption === "import" && (
                        <form.Field name="importedDevWalletKey">
                          {(field) => {
                            const isInvalid = getIsInvalid(field);
                            return (
                              <Field data-invalid={isInvalid}>
                                <Input
                                  className="font-mono text-sm"
                                  placeholder="Enter private key..."
                                  value={field.state.value}
                                  onBlur={field.handleBlur}
                                  onChange={(e) =>
                                    field.handleChange(e.target.value)
                                  }
                                  aria-invalid={isInvalid}
                                />
                                {isInvalid && (
                                  <FieldError
                                    errors={field.state.meta.errors}
                                  />
                                )}
                              </Field>
                            );
                          }}
                        </form.Field>
                      )}
                      {devWalletOption === "generate" && (
                        <p className="text-sm text-muted-foreground flex items-center h-full">
                          A new wallet will be generated for dev operations
                        </p>
                      )}
                      {devWalletOption === "use_main" && (
                        <p className="text-sm text-muted-foreground flex items-center h-full">
                          Your main wallet will be used as the dev wallet for
                          this launch
                        </p>
                      )}
                    </div>
                  )}
                </form.Subscribe>
              </Field>

              <form.Field name="devBuyAmountSol">
                {(field) => {
                  const isInvalid = getIsInvalid(field);
                  return (
                    <Field data-invalid={isInvalid}>
                      <div className="flex items-center gap-2 mb-1">
                        <FieldLabel htmlFor={field.name}>
                          Dev Buy Amount (SOL)
                        </FieldLabel>
                        <Tooltip>
                          <TooltipTrigger>
                            <Info className="h-4 w-4 text-muted-foreground" />
                          </TooltipTrigger>
                          <TooltipContent>
                            Amount of SOL the dev wallet will use to buy tokens
                          </TooltipContent>
                        </Tooltip>
                      </div>
                      <Input
                        id={field.name}
                        type="number"
                        step="0.0001"
                        min="0.05"
                        max="100"
                        value={field.state.value}
                        onBlur={field.handleBlur}
                        onChange={(e) =>
                          field.handleChange(e.target.valueAsNumber || 0)
                        }
                        placeholder="0"
                        aria-invalid={isInvalid}
                      />
                      {isInvalid && (
                        <FieldError errors={field.state.meta.errors} />
                      )}
                    </Field>
                  );
                }}
              </form.Field>
            </div>
          </PageSection>
        </section>
        <PageSectionDivider />

        {/* Step 3: Bundler Settings */}
        <section id="bundler-settings" className="scroll-mt-4">
          <PageSection>
            <PageSectionHeader
              title="Bundler Settings"
              className="flex-row items-center justify-start gap-3"
              meta={
                <div className="mb-1 flex items-center gap-2">
                  <Tooltip>
                    <TooltipTrigger>
                      <Info className="h-4 w-4 text-muted-foreground" />
                    </TooltipTrigger>
                    <TooltipContent>
                      Enable bundler to buy tokens within the same transaction
                      with the token creation. Enabling this feature costs 0.1
                      SOL.
                    </TooltipContent>
                  </Tooltip>
                  <form.Field name="bundleBuyEnabled">
                    {(field) => (
                      <Switch
                        id="bundle-buy"
                        size="lg"
                        checked={field.state.value}
                        onCheckedChange={field.handleChange}
                      />
                    )}
                  </form.Field>
                </div>
              }
            />
            <div>
              <form.Subscribe
                selector={(state) => state.values.bundleBuyEnabled}
              >
                {(bundleBuyEnabled) =>
                  bundleBuyEnabled && (
                    <div className="space-y-6">
                      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 md:gap-6">
                        <form.Field name="bundlerWalletCount">
                          {(field) => {
                            const isInvalid = getIsInvalid(field);
                            return (
                              <Field data-invalid={isInvalid}>
                                <FieldLabel htmlFor={field.name}>
                                  Number of Wallets
                                </FieldLabel>
                                <Input
                                  id={field.name}
                                  type="number"
                                  min="1"
                                  max="10"
                                  value={field.state.value}
                                  onBlur={field.handleBlur}
                                  onChange={(e) =>
                                    field.handleChange(
                                      e.target.valueAsNumber || 0
                                    )
                                  }
                                  placeholder="5"
                                  aria-invalid={isInvalid}
                                />
                                <FieldDescription>
                                  How many wallets to use for bundle buy (max
                                  10)
                                </FieldDescription>
                                {isInvalid && (
                                  <FieldError
                                    errors={field.state.meta.errors}
                                  />
                                )}
                              </Field>
                            );
                          }}
                        </form.Field>
                        <form.Field name="bundlerBuyAmountSol">
                          {(field) => {
                            const isInvalid = getIsInvalid(field);
                            return (
                              <Field data-invalid={isInvalid}>
                                <FieldLabel htmlFor={field.name}>
                                  Buy Amount per Wallet (SOL)
                                </FieldLabel>
                                <Input
                                  id={field.name}
                                  type="number"
                                  step="0.001"
                                  min="0.1"
                                  value={field.state.value}
                                  onBlur={field.handleBlur}
                                  onChange={(e) =>
                                    field.handleChange(
                                      e.target.valueAsNumber || 0
                                    )
                                  }
                                  placeholder="0.1"
                                  aria-invalid={isInvalid}
                                />
                                <FieldDescription>
                                  Base SOL amount each wallet will spend
                                </FieldDescription>
                                {isInvalid && (
                                  <FieldError
                                    errors={field.state.meta.errors}
                                  />
                                )}
                              </Field>
                            );
                          }}
                        </form.Field>
                      </div>

                      <Collapsible>
                        <CollapsibleTrigger asChild>
                          <button
                            type="button"
                            className="group flex w-full items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
                          >
                            <ChevronRight className="h-4 w-4 transition-transform group-data-[state=open]:rotate-90" />
                            Advanced Settings
                          </button>
                        </CollapsibleTrigger>
                        <CollapsibleContent className="pt-4">
                          <div className="space-y-6">
                            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 md:gap-6">
                              <form.Field name="bundlerBuyVariancePercent">
                                {(field) => {
                                  const isInvalid = getIsInvalid(field);
                                  return (
                                    <Field data-invalid={isInvalid}>
                                      <FieldLabel htmlFor={field.name}>
                                        Buy Amount Variance (%)
                                      </FieldLabel>
                                      <Input
                                        id={field.name}
                                        type="number"
                                        min="0"
                                        max="50"
                                        value={field.state.value}
                                        onBlur={field.handleBlur}
                                        onChange={(e) =>
                                          field.handleChange(
                                            e.target.valueAsNumber || 0
                                          )
                                        }
                                        placeholder="20"
                                        aria-invalid={isInvalid}
                                      />
                                      <FieldDescription>
                                        Random variance applied to each buy
                                        (0-50%)
                                      </FieldDescription>
                                      {isInvalid && (
                                        <FieldError
                                          errors={field.state.meta.errors}
                                        />
                                      )}
                                    </Field>
                                  );
                                }}
                              </form.Field>
                              <form.Field name="distributionWalletMultiplier">
                                {(field) => {
                                  const isInvalid = getIsInvalid(field);
                                  return (
                                    <Field data-invalid={isInvalid}>
                                      <FieldLabel htmlFor={field.name}>
                                        Distribution Multiplier
                                      </FieldLabel>
                                      <Input
                                        id={field.name}
                                        type="number"
                                        min="1"
                                        max="5"
                                        value={field.state.value}
                                        onBlur={field.handleBlur}
                                        onChange={(e) =>
                                          field.handleChange(
                                            e.target.valueAsNumber || 1
                                          )
                                        }
                                        placeholder="1"
                                        aria-invalid={isInvalid}
                                      />
                                      <FieldDescription>
                                        Multiply wallets after launch (1 = no
                                        distribution)
                                      </FieldDescription>
                                      {isInvalid && (
                                        <FieldError
                                          errors={field.state.meta.errors}
                                        />
                                      )}
                                    </Field>
                                  );
                                }}
                              </form.Field>
                            </div>
                            <form.Field name="jitoTipAmountSol">
                              {(field) => {
                                const isInvalid = getIsInvalid(field);
                                return (
                                  <Field data-invalid={isInvalid}>
                                    <div className="flex items-center gap-2 mb-1">
                                      <FieldLabel htmlFor={field.name}>
                                        Jito Tip Amount (SOL)
                                      </FieldLabel>
                                      <Tooltip>
                                        <TooltipTrigger>
                                          <Info className="h-4 w-4 text-muted-foreground" />
                                        </TooltipTrigger>
                                        <TooltipContent>
                                          Priority fee for faster transaction
                                          confirmation
                                        </TooltipContent>
                                      </Tooltip>
                                    </div>
                                    <Input
                                      id={field.name}
                                      type="number"
                                      step="0.0001"
                                      min="0"
                                      max="1"
                                      value={field.state.value}
                                      onBlur={field.handleBlur}
                                      onChange={(e) =>
                                        field.handleChange(
                                          e.target.valueAsNumber || 0
                                        )
                                      }
                                      placeholder="0.001"
                                      aria-invalid={isInvalid}
                                    />
                                    {isInvalid && (
                                      <FieldError
                                        errors={field.state.meta.errors}
                                      />
                                    )}
                                  </Field>
                                );
                              }}
                            </form.Field>
                          </div>
                        </CollapsibleContent>
                      </Collapsible>

                      <form.Subscribe
                        selector={(state) => ({
                          bundlerWalletCount: state.values.bundlerWalletCount,
                          bundlerBuyAmountSol: state.values.bundlerBuyAmountSol,
                          distributionWalletMultiplier:
                            state.values.distributionWalletMultiplier,
                        })}
                      >
                        {({
                          bundlerWalletCount,
                          bundlerBuyAmountSol,
                          distributionWalletMultiplier,
                        }) => {
                          const totalBuy =
                            bundlerWalletCount * bundlerBuyAmountSol;
                          const totalWallets =
                            bundlerWalletCount * distributionWalletMultiplier;

                          return (
                            <div className="rounded-lg border bg-muted/50 p-4">
                              <div className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-2">
                                <div>
                                  <span className="text-muted-foreground">
                                    Total Bundle Buy
                                  </span>
                                  <p className="text-lg font-semibold">
                                    {totalBuy.toFixed(4)} SOL
                                  </p>
                                </div>
                                <div>
                                  <span className="text-muted-foreground">
                                    Total Wallets After Distribution
                                  </span>
                                  <p className="text-lg font-semibold">
                                    {totalWallets} wallets
                                  </p>
                                </div>
                              </div>
                            </div>
                          );
                        }}
                      </form.Subscribe>
                    </div>
                  )
                }
              </form.Subscribe>
            </div>
          </PageSection>
        </section>
        <PageSectionDivider />

        {/* Step 4: Review */}
        <section id="review" className="">
          <PageSection className="-mb-18">
            <PageSectionHeader title="Review" />
            <div>
              <form.Subscribe selector={(state) => state.values}>
                {(values) => {
                  const planDiscountRate =
                    currentUser?.plan === "PRO"
                      ? 1
                      : currentUser?.plan === "DEVELOPER"
                        ? DEVELOPER_FEE_DISCOUNT_RATE
                        : 0;
                  const { totalCostSol, distributionWallets, usageFees } =
                    calculateLaunchTotals({
                      ...values,
                      platformFeeDiscountRate: planDiscountRate,
                    });
                  const vanityFeeDisplaySol = values.vanityMint
                    ? usageFees.vanityMintFeeSol
                    : vanityMintFeeSol;
                  const attributionFeeDisplaySol = values.removeAttribution
                    ? usageFees.descriptionAttributionRemovalFeeSol
                    : descriptionAttributionRemovalFeeSol;
                  const bundleFeeDisplaySol = values.bundleBuyEnabled
                    ? usageFees.bundleBuyFeeSol
                    : bundleBuyFeeSol;
                  const reviewDescription = getReviewDescription(
                    values.description,
                    values.removeAttribution
                  );
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
                            <div className="h-16 w-16 rounded-xl bg-muted flex items-center justify-center">
                              <ImagePlus className="h-6 w-6 text-muted-foreground" />
                            </div>
                          )}
                          <div>
                            <p className="text-lg font-semibold">
                              {values.tokenName || "Token Name"}
                            </p>
                            <p className="text-sm text-muted-foreground">
                              ${values.tokenSymbol || "SYMBOL"}
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
                            <span className="text-muted-foreground">
                              Description
                            </span>
                            <span className="text-foreground line-clamp-3 whitespace-pre-line">
                              {reviewDescription}
                            </span>
                          </div>
                          {(values.twitter ||
                            values.telegram ||
                            values.website) && (
                            <div className="grid grid-cols-[140px_1fr] gap-2">
                              <span className="text-muted-foreground">
                                Social Links
                              </span>
                              <div className="flex gap-2">
                                {values.twitter && (
                                  <span className="text-xs bg-muted px-2 py-0.5 rounded">
                                    Twitter
                                  </span>
                                )}
                                {values.telegram && (
                                  <span className="text-xs bg-muted px-2 py-0.5 rounded">
                                    Telegram
                                  </span>
                                )}
                                {values.website && (
                                  <span className="text-xs bg-muted px-2 py-0.5 rounded">
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
                          <div className="text-sm font-medium mb-3">
                            Launch Configuration
                          </div>
                          <div className="grid gap-3 text-sm">
                            <div className="grid grid-cols-[140px_1fr] gap-2">
                              <span className="text-muted-foreground">
                                Dev Wallet
                              </span>
                              <span>
                                {values.devWalletOption === "system"
                                  ? "System Wallet"
                                  : values.devWalletOption === "import"
                                    ? "Imported wallet"
                                    : values.devWalletOption === "generate"
                                      ? "Will be generated"
                                      : "Main Wallet (used as dev)"}
                              </span>
                            </div>
                            <div className="grid grid-cols-[140px_1fr] gap-2">
                              <span className="text-muted-foreground">
                                Dev Buy
                              </span>
                              <span>
                                {values.devBuyAmountSol.toFixed(4)} SOL
                              </span>
                            </div>
                            {values.bundleBuyEnabled && (
                              <div className="grid grid-cols-[140px_1fr] gap-2">
                                <span className="text-muted-foreground">
                                  Jito Tip
                                </span>
                                <span>
                                  {values.jitoTipAmountSol.toFixed(4)} SOL
                                </span>
                              </div>
                            )}
                            {values.bundleBuyEnabled && (
                              <>
                                <div className="grid grid-cols-[140px_1fr] gap-2">
                                  <span className="text-muted-foreground">
                                    Bundle Buy
                                  </span>
                                  <span>
                                    {values.bundlerWalletCount} wallets ×{" "}
                                    {values.bundlerBuyAmountSol} SOL (±
                                    {values.bundlerBuyVariancePercent}%)
                                  </span>
                                </div>
                                {values.distributionWalletMultiplier > 1 && (
                                  <div className="grid grid-cols-[140px_1fr] gap-2">
                                    <span className="text-muted-foreground">
                                      Distribution
                                    </span>
                                    <span>
                                      {distributionWallets} wallets after ×
                                      {values.distributionWalletMultiplier}{" "}
                                      distribution
                                    </span>
                                  </div>
                                )}
                              </>
                            )}
                            {!values.bundleBuyEnabled && (
                              <div className="grid grid-cols-[140px_1fr] gap-2">
                                <span className="text-muted-foreground">
                                  Bundle Buy
                                </span>
                                <span>Disabled</span>
                              </div>
                            )}
                            <div className="grid grid-cols-[140px_1fr] gap-2">
                              <span className="text-muted-foreground">
                                Vanity Address
                              </span>
                              <span>
                                {values.vanityMint ? "Enabled" : "Disabled"}
                              </span>
                            </div>
                            <div className="grid grid-cols-[140px_1fr] gap-2">
                              <span className="text-muted-foreground">
                                Attribution
                              </span>
                              <span>
                                {values.removeAttribution
                                  ? "Removed"
                                  : "Included by default"}
                              </span>
                            </div>
                          </div>
                        </div>

                        <div className="h-fit rounded-xl border bg-muted/30 p-4">
                          <div className="space-y-3 text-sm">
                            <div className="flex items-center justify-between border-b pb-3">
                              <span className="font-medium">Total fees</span>
                              <span className="tabular-nums font-medium">
                                {usageFees.totalFeeSol.toFixed(4)} SOL
                              </span>
                            </div>
                            {usageFees.platformFeeWaived ? (
                              <div className="text-xs text-emerald-400">
                                Pro active. Platform fees are waived for this
                                launch.
                              </div>
                            ) : usageFees.platformFeeDiscountRate > 0 ? (
                              <div className="text-xs text-emerald-400">
                                Developer active. Platform fees are reduced by{" "}
                                {Math.round(usageFees.platformFeeDiscountRate * 100)}%
                                for this launch.
                              </div>
                            ) : null}
                            <div
                              className={cn(
                                "flex items-center justify-between",
                                usageFees.generatedWalletCount === 0 &&
                                  "opacity-50 line-through"
                              )}
                            >
                              <div className="text-muted-foreground">
                                Generated wallets fee
                                <span className="ml-2 text-xs">
                                  ({usageFees.generatedWalletCount} wallets)
                                </span>
                              </div>
                              <span className="tabular-nums">
                                {usageFees.generatedWalletFeeSol.toFixed(4)} SOL
                              </span>
                            </div>
                            <div
                              className={cn(
                                "flex items-center justify-between",
                                !values.vanityMint && "opacity-50 line-through"
                              )}
                            >
                              <div className="text-muted-foreground">
                                Vanity mint fee
                              </div>
                              <span className="tabular-nums">
                                {vanityFeeDisplaySol.toFixed(4)} SOL
                              </span>
                            </div>
                            <div
                              className={cn(
                                "flex items-center justify-between",
                                !values.removeAttribution &&
                                  "opacity-50 line-through"
                              )}
                            >
                              <div className="text-muted-foreground">
                                Attribution removal fee
                              </div>
                              <span className="tabular-nums">
                                {attributionFeeDisplaySol.toFixed(4)} SOL
                              </span>
                            </div>
                            <div
                              className={cn(
                                "flex items-center justify-between",
                                !values.bundleBuyEnabled &&
                                  "opacity-50 line-through"
                              )}
                            >
                              <div className="text-muted-foreground">
                                Bundler fee
                              </div>
                              <span className="tabular-nums">
                                {bundleFeeDisplaySol.toFixed(4)} SOL
                              </span>
                            </div>
                            <div className="border-t pt-3">
                              <div className="mb-2 flex items-center justify-between">
                                <span className="font-medium">
                                  Temporary reserves
                                </span>
                                <div className="flex items-center gap-1 text-xs text-muted-foreground">
                                  <span>Will be returned</span>
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <button
                                        type="button"
                                        className="inline-flex text-muted-foreground transition-colors hover:text-foreground"
                                        aria-label="Temporary reserves info"
                                      >
                                        <Info className="size-3.5" />
                                      </button>
                                    </TooltipTrigger>
                                    <TooltipContent side="top">
                                      These are temporary reserves added to help
                                      the launch complete. Any unused amount is
                                      returned to your main wallet after
                                      cleanup.
                                    </TooltipContent>
                                  </Tooltip>
                                </div>
                              </div>
                              <div className="space-y-2">
                                <div className="flex items-center justify-between">
                                  <div className="flex items-center gap-1.5 text-muted-foreground">
                                    <span>Creator reserve</span>
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <button
                                          type="button"
                                          className="inline-flex text-muted-foreground transition-colors hover:text-foreground"
                                          aria-label="Creator reserve info"
                                        >
                                          <Info className="size-3.5" />
                                        </button>
                                      </TooltipTrigger>
                                      <TooltipContent side="top">
                                        Temporary SOL reserved for token
                                        creation and creator-side launch steps.
                                        Any unused amount is expected to be
                                        returned after launch cleanup.
                                      </TooltipContent>
                                    </Tooltip>
                                  </div>
                                  <span className="tabular-nums text-xs text-muted-foreground">
                                    {preview
                                      ? `${preview.lineItems.creatorReserveSol.toFixed(4)} SOL`
                                      : "Calculating..."}
                                  </span>
                                </div>
                                <div
                                  className={cn(
                                    "flex items-center justify-between",
                                    !values.bundleBuyEnabled && "opacity-50"
                                  )}
                                >
                                  <div className="flex items-center gap-1.5 text-muted-foreground">
                                    <span>Buy wallet reserve</span>
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <button
                                          type="button"
                                          className="inline-flex text-muted-foreground transition-colors hover:text-foreground"
                                          aria-label="Buy wallet reserve info"
                                        >
                                          <Info className="size-3.5" />
                                        </button>
                                      </TooltipTrigger>
                                      <TooltipContent side="top">
                                        Temporary SOL reserved across buy
                                        wallets so bundle execution can complete
                                        smoothly. Any unused amount is expected
                                        to be returned after launch cleanup.
                                      </TooltipContent>
                                    </Tooltip>
                                  </div>
                                  <span className="tabular-nums text-xs text-muted-foreground">
                                    {values.bundleBuyEnabled
                                      ? preview
                                        ? `${preview.lineItems.buyWalletReserveSol.toFixed(4)} SOL`
                                        : "Calculating..."
                                      : "Not needed"}
                                  </span>
                                </div>
                                <div className="flex items-center justify-between">
                                  <div className="flex items-center gap-1.5 text-muted-foreground">
                                    <span>Transfer reserve</span>
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <button
                                          type="button"
                                          className="inline-flex text-muted-foreground transition-colors hover:text-foreground"
                                          aria-label="Transfer reserve info"
                                        >
                                          <Info className="size-3.5" />
                                        </button>
                                      </TooltipTrigger>
                                      <TooltipContent side="top">
                                        A small temporary amount reserved so
                                        launch wallets can send remaining SOL
                                        back during cleanup. Any unused amount
                                        is expected to be returned after launch
                                        cleanup.
                                      </TooltipContent>
                                    </Tooltip>
                                  </div>
                                  <span className="tabular-nums text-xs text-muted-foreground">
                                    {preview
                                      ? `${preview.lineItems.transferReserveSol.toFixed(4)} SOL`
                                      : "Calculating..."}
                                  </span>
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>

                      <div className="mt-8 -mx-4 border-t bg-muted/30 px-4 py-8 md:-mx-6 md:px-6 md:py-10 xl:-mx-8 xl:px-8">
                        <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
                          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:flex lg:items-center lg:gap-10">
                            <div className="space-y-1">
                              <div className="text-xs text-muted-foreground">
                                Total fees
                              </div>
                              <div className="text-2xl font-light tabular-nums">
                                {usageFees.totalFeeSol.toFixed(4)}
                                <span className="ml-1 text-sm text-muted-foreground">
                                  SOL
                                </span>
                              </div>
                            </div>
                            <div className="space-y-1">
                              <div className="text-xs text-muted-foreground">
                                Total generated wallets
                              </div>
                              <div className="text-2xl font-light tabular-nums">
                                {usageFees.generatedWalletCount}
                              </div>
                            </div>
                            <div className="space-y-1">
                              <div className="text-xs text-muted-foreground">
                                Estimated main-wallet spend
                              </div>
                              <div className="text-2xl font-light tabular-nums">
                                {totalCostSol.toFixed(4)}
                                <span className="ml-1 text-sm text-muted-foreground">
                                  SOL
                                </span>
                              </div>
                            </div>
                          </div>
                          <Button
                            size="lg"
                            type="submit"
                            form="launch-form"
                            className="h-11 w-full shrink-0 border border-black px-4 text-xl font-black tracking-tight text-black/90 shadow-lg shadow-lime-400/10 hover:text-black hover:shadow-xl hover:shadow-lime-300/20 sm:w-auto sm:text-2xl md:h-12 md:text-3xl"
                          >
                            LAUNCH TOKEN
                          </Button>
                        </div>
                      </div>
                    </div>
                  );
                }}
              </form.Subscribe>
            </div>
          </PageSection>
        </section>
      </form>
      <LaunchOverviewDialog
        open={showLaunchDialog}
        onOpenChange={setShowLaunchDialog}
        onConfirm={handleConfirmLaunch}
        launchInput={form.state.values}
        imagePreview={imagePreview}
        bannerPreview={bannerPreview}
        isLoading={startLaunchMutation.isPending}
      />
      <LaunchProgressDialog
        open={isProgressOpen}
        onOpenChange={setIsProgressOpen}
        launch={launchStatusQuery.data ?? activeLaunchQuery.data ?? null}
        onCancel={() => {
          if (activeLaunchId) {
            cancelLaunchMutation.mutate({ launchId: activeLaunchId });
          }
        }}
        onClose={() => {
          setIsProgressOpen(false);
          const status =
            launchStatusQuery.data?.status ?? activeLaunchQuery.data?.status;
          if (
            status === "SUCCEEDED" ||
            status === "FAILED" ||
            status === "CANCELED"
          ) {
            clearActiveLaunch();
          }
        }}
        onRetry={() => {
          const launch =
            launchStatusQuery.data ?? activeLaunchQuery.data ?? null;
          if (!launch) {
            return;
          }
          retryLaunchMutation.mutate({ launchId: launch.id });
        }}
        retryPending={retryLaunchMutation.isPending}
      />
    </div>
  );
}
