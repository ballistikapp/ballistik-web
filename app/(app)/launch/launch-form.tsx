"use client";

import * as React from "react";
import { useForm } from "@tanstack/react-form";
import { toast } from "sonner";
import * as z from "zod";
import { ImagePlus, X, Info, Import, Sparkles, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
import { cn } from "@/lib/utils";
import { Separator } from "@/components/ui/separator";
import { LaunchOverviewDialog } from "@/app/(app)/launch/launch-overview-dialog";
import { LaunchProgressDialog } from "@/app/(app)/launch/launch-progress-dialog";
import { useRouter } from "next/navigation";
import { trpc } from "@/lib/trpc/client";

const formSchema = z.object({
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
    .min(20, "Description must be at least 20 characters")
    .max(500, "Description must be at most 500 characters"),
  tokenImage: z.string().min(1, "Main image or video is required"),
  tokenBanner: z.string(),
  twitter: z.string(),
  telegram: z.string(),
  website: z.string(),
  devWalletOption: z.enum(["import", "generate", "use_main"]),
  importedDevWalletKey: z.string(),
  devBuyAmountSol: z.number().positive("Dev buy amount must be greater than 0"),
  jitoTipAmountSol: z.number().min(0, "Jito tip amount must be 0 or more"),
  bundleBuyEnabled: z.boolean(),
  vanityMint: z.boolean(),
  bundlerWalletCount: z
    .number()
    .int()
    .min(0, "Bundler wallet count must be 0 or more")
    .max(10, "Bundler wallet count must be 10 or less"),
  bundlerBuyAmountSol: z
    .number()
    .min(0, "Bundler buy amount must be 0 or more"),
  bundlerBuyVariancePercent: z
    .number()
    .min(0, "Bundler buy variance must be 0 or more")
    .max(50, "Bundler buy variance must be 50 or less"),
  distributionWalletMultiplier: z
    .number()
    .int()
    .min(1, "Distribution multiplier must be at least 1")
    .max(5, "Distribution multiplier must be 5 or less"),
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

const readImageDimensions = (file: File) =>
  new Promise<{ width: number; height: number }>((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
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

const steps = [
  {
    id: "token-details",
    title: "Token Details",
    description: "Set up your token's name, symbol, image, and social links",
  },
  {
    id: "launch-settings",
    title: "Launch Settings",
    description: "Select wallets, set dev buy amount and Jito tip for priority",
  },
  {
    id: "bundler-settings",
    title: "Bundler Settings",
    description: "Configure bundle buy wallets and token distribution settings",
  },
  {
    id: "review",
    title: "Review",
    description: "Review all details and launch your token on pump.fun",
  },
];

function calculateLaunchTotals(values: {
  devBuyAmountSol: number;
  jitoTipAmountSol: number;
  bundleBuyEnabled: boolean;
  bundlerWalletCount: number;
  bundlerBuyAmountSol: number;
  distributionWalletMultiplier: number;
}) {
  const bundleBuyTotal = values.bundleBuyEnabled
    ? values.bundlerWalletCount * values.bundlerBuyAmountSol
    : 0;
  const totalCostSol =
    values.devBuyAmountSol + bundleBuyTotal + values.jitoTipAmountSol;
  const distributionWallets =
    values.bundlerWalletCount * values.distributionWalletMultiplier;

  return { bundleBuyTotal, totalCostSol, distributionWallets };
}

export function LaunchForm() {
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

  const activeLaunchQuery = trpc.launch.getActive.useQuery();
  const refreshWalletBalancesMutation = trpc.wallet.refreshBalances.useMutation();
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
  const scrollToStep = (stepId: string) => {
    const element = document.getElementById(stepId);
    if (element) {
      element.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  };

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
  };

  const removeBanner = () => {
    setBannerPreview(null);
    form.setFieldValue("tokenBanner", "");
    resetBannerInput();
  };

  const form = useForm({
    defaultValues: {
      tokenName: "",
      tokenSymbol: "",
      description: "",
      tokenImage: "",
      tokenBanner: "",
      twitter: "",
      telegram: "",
      website: "",
      devWalletOption: "generate" as "import" | "generate" | "use_main",
      importedDevWalletKey: "",
      devBuyAmountSol: 0.05,
      jitoTipAmountSol: 0.001,
      bundleBuyEnabled: true,
      vanityMint: false,
      bundlerWalletCount: 5,
      bundlerBuyAmountSol: 0.01,
      bundlerBuyVariancePercent: 20,
      distributionWalletMultiplier: 1,
    },
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
      description: values.description,
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
      bundlerWalletCount: values.bundlerWalletCount,
      bundlerBuyAmountSol: values.bundlerBuyAmountSol,
      bundlerBuyVariancePercent: values.bundlerBuyVariancePercent,
      distributionWalletMultiplier: values.distributionWalletMultiplier,
    });
  };

  return (
    <div className="flex gap-8">
      {/* Sidebar Navigation */}

      {/* Form Content */}
      <div className="flex-1 space-y-6 pb-12">
        <form
          id="launch-form"
          onSubmit={(e) => {
            e.preventDefault();
            form.handleSubmit();
          }}
          className="space-y-8"
        >
          {/* Step 1: Token Details */}
          <Card id="token-details" className="scroll-mt-4">
            <CardHeader>
              <CardTitle className="text-primary text-xl">
                Token Details
              </CardTitle>
              <CardDescription>
                Basic information about your token
              </CardDescription>
            </CardHeader>
            <Separator />
            <CardContent>
              <div className="grid grid-cols-2 gap-6">
                <div className="space-y-4">
                  <form.Field name="tokenName">
                    {(field) => {
                      const isInvalid =
                        field.state.meta.isTouched && !field.state.meta.isValid;
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
                            placeholder="My Awesome Token"
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
                      const isInvalid =
                        field.state.meta.isTouched && !field.state.meta.isValid;
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
                            placeholder="MAT"
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

                <Field>
                  <FieldLabel>Main Image</FieldLabel>
                  <div className="flex items-start gap-4">
                    <div
                      className={cn(
                        "relative flex h-24 w-24 shrink-0 items-center justify-center rounded-xl border-2 border-dashed transition-colors",
                        imagePreview
                          ? "border-transparent"
                          : "border-muted-foreground/25 hover:border-muted-foreground/50"
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
                          onClick={() => mainMediaInputRef.current?.click()}
                          className="flex h-full w-full flex-col items-center justify-center gap-1 text-muted-foreground hover:text-foreground"
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
                    <div className="text-sm text-muted-foreground space-y-1">
                      <p className="font-medium text-foreground">
                        File size and type
                      </p>
                      <p>
                        Image - max 15MB. &quot;.jpg&quot;, &quot;.gif&quot; or
                        &quot;.png&quot; recommended
                      </p>
                      <p>Video - max 30MB. &quot;.mp4&quot; recommended</p>
                      <p className="pt-2 font-medium text-foreground">
                        Resolution and aspect ratio
                      </p>
                      <p>Image - 1:1 square recommended (1000x1000px+)</p>
                      <p>Video - 16:9 or 9:16, 1080p+ recommended</p>
                    </div>
                  </div>
                </Field>
                <Field className="col-span-2">
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
                </Field>
                <form.Field name="description">
                  {(field) => {
                    const isInvalid =
                      field.state.meta.isTouched && !field.state.meta.isValid;
                    return (
                      <Field data-invalid={isInvalid} className="col-span-2">
                        <FieldLabel htmlFor={field.name}>
                          Description
                        </FieldLabel>
                        <InputGroup>
                          <InputGroupTextarea
                            id={field.name}
                            name={field.name}
                            value={field.state.value}
                            onBlur={field.handleBlur}
                            onChange={(e) => field.handleChange(e.target.value)}
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
                <div className="col-span-2 border-t pt-4">
                  <p className="text-sm font-medium mb-3">
                    Social Links (optional)
                  </p>
                  <div className="grid grid-cols-3 gap-4">
                    <form.Field name="twitter">
                      {(field) => {
                        const isInvalid =
                          field.state.meta.isTouched &&
                          !field.state.meta.isValid;
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
                        const isInvalid =
                          field.state.meta.isTouched &&
                          !field.state.meta.isValid;
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
                        const isInvalid =
                          field.state.meta.isTouched &&
                          !field.state.meta.isValid;
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
              </div>
            </CardContent>
          </Card>

          {/* Step 2: Launch Settings */}
          <Card id="launch-settings" className="scroll-mt-4">
            <CardHeader>
              <CardTitle className="text-primary text-xl">
                Launch Settings
              </CardTitle>
              <CardDescription>
                Select wallets and configure launch parameters
              </CardDescription>
            </CardHeader>
            <Separator />
            <CardContent className="space-y-6">
              <Field>
                <div className="flex items-center gap-2 mb-1">
                  <FieldLabel>Dev Wallet</FieldLabel>
                  <Tooltip>
                    <TooltipTrigger>
                      <Info className="h-4 w-4 text-muted-foreground" />
                    </TooltipTrigger>
                    <TooltipContent>
                      The wallet that will make the dev buy
                    </TooltipContent>
                  </Tooltip>
                </div>
                <form.Field name="devWalletOption">
                  {(field) => (
                    <div className="flex gap-2">
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
                    </div>
                  )}
                </form.Field>
                <form.Subscribe
                  selector={(state) => state.values.devWalletOption}
                >
                  {(devWalletOption) => (
                    <div className="mt-2 h-9">
                      {devWalletOption === "import" && (
                        <form.Field name="importedDevWalletKey">
                          {(field) => (
                            <Input
                              className="font-mono text-sm"
                              placeholder="Enter private key..."
                              value={field.state.value}
                              onChange={(e) =>
                                field.handleChange(e.target.value)
                              }
                            />
                          )}
                        </form.Field>
                      )}
                      {devWalletOption === "generate" && (
                        <p className="text-sm text-muted-foreground flex items-center h-full">
                          A new wallet will be generated for dev operations
                        </p>
                      )}
                      {devWalletOption === "use_main" && (
                        <p className="text-sm text-muted-foreground flex items-center h-full">
                          Your connected wallet will be used for dev operations
                        </p>
                      )}
                    </div>
                  )}
                </form.Subscribe>
              </Field>

              <div className="grid grid-cols-2 gap-6">
                <form.Field name="devBuyAmountSol">
                  {(field) => (
                    <Field>
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
                        onChange={(e) =>
                          field.handleChange(e.target.valueAsNumber || 0)
                        }
                        placeholder="0"
                      />
                    </Field>
                  )}
                </form.Field>
                <form.Field name="jitoTipAmountSol">
                  {(field) => (
                    <Field>
                      <div className="flex items-center gap-2 mb-1">
                        <FieldLabel htmlFor={field.name}>
                          Jito Tip Amount (SOL)
                        </FieldLabel>
                        <Tooltip>
                          <TooltipTrigger>
                            <Info className="h-4 w-4 text-muted-foreground" />
                          </TooltipTrigger>
                          <TooltipContent>
                            Priority fee for faster transaction confirmation
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
                        onChange={(e) =>
                          field.handleChange(e.target.valueAsNumber || 0)
                        }
                        placeholder="0.001"
                      />
                    </Field>
                  )}
                </form.Field>
              </div>

              <div className="flex items-center space-x-3 pt-2">
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
                      Generate a custom token address starting with
                      &quot;pump&quot;
                    </TooltipContent>
                  </Tooltip>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Step 3: Bundler Settings */}
          <Card id="bundler-settings" className="scroll-mt-4">
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-primary text-xl">
                    Bundler Settings
                  </CardTitle>
                  <CardDescription>
                    Configure bundle buy wallets and distribution
                  </CardDescription>
                </div>
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
            </CardHeader>
            <Separator />
            <CardContent>
              <form.Subscribe
                selector={(state) => state.values.bundleBuyEnabled}
              >
                {(bundleBuyEnabled) =>
                  bundleBuyEnabled && (
                    <div className="space-y-6">
                      <div className="grid grid-cols-2 gap-6">
                        <form.Field name="bundlerWalletCount">
                          {(field) => (
                            <Field>
                              <FieldLabel htmlFor={field.name}>
                                Number of Wallets
                              </FieldLabel>
                              <Input
                                id={field.name}
                                type="number"
                                min="1"
                                max="10"
                                value={field.state.value}
                                onChange={(e) =>
                                  field.handleChange(
                                    e.target.valueAsNumber || 0
                                  )
                                }
                                placeholder="5"
                              />
                              <FieldDescription>
                                How many wallets to use for bundle buy (max 10)
                              </FieldDescription>
                            </Field>
                          )}
                        </form.Field>
                        <form.Field name="bundlerBuyAmountSol">
                          {(field) => (
                            <Field>
                              <FieldLabel htmlFor={field.name}>
                                Buy Amount per Wallet (SOL)
                              </FieldLabel>
                              <Input
                                id={field.name}
                                type="number"
                                step="0.001"
                                min="0.001"
                                value={field.state.value}
                                onChange={(e) =>
                                  field.handleChange(
                                    e.target.valueAsNumber || 0
                                  )
                                }
                                placeholder="0.01"
                              />
                              <FieldDescription>
                                Base SOL amount each wallet will spend
                              </FieldDescription>
                            </Field>
                          )}
                        </form.Field>
                      </div>

                      <div className="grid grid-cols-2 gap-6">
                        <form.Field name="bundlerBuyVariancePercent">
                          {(field) => (
                            <Field>
                              <FieldLabel htmlFor={field.name}>
                                Buy Amount Variance (%)
                              </FieldLabel>
                              <Input
                                id={field.name}
                                type="number"
                                min="0"
                                max="50"
                                value={field.state.value}
                                onChange={(e) =>
                                  field.handleChange(
                                    e.target.valueAsNumber || 0
                                  )
                                }
                                placeholder="20"
                              />
                              <FieldDescription>
                                Random variance applied to each buy (0-50%)
                              </FieldDescription>
                            </Field>
                          )}
                        </form.Field>
                        <form.Field name="distributionWalletMultiplier">
                          {(field) => (
                            <Field>
                              <FieldLabel htmlFor={field.name}>
                                Distribution Multiplier
                              </FieldLabel>
                              <Input
                                id={field.name}
                                type="number"
                                min="1"
                                max="5"
                                value={field.state.value}
                                onChange={(e) =>
                                  field.handleChange(
                                    e.target.valueAsNumber || 1
                                  )
                                }
                                placeholder="1"
                              />
                              <FieldDescription>
                                Multiply wallets after launch (1 = no
                                distribution)
                              </FieldDescription>
                            </Field>
                          )}
                        </form.Field>
                      </div>

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
                              <div className="grid grid-cols-2 gap-4 text-sm">
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
            </CardContent>
          </Card>

          {/* Step 4: Review */}
          <Card id="review" className="scroll-mt-4">
            <CardHeader>
              <CardTitle className="text-primary text-xl">Review</CardTitle>
              <CardDescription>
                Review your token details before launching
              </CardDescription>
            </CardHeader>
            <Separator />
            <CardContent>
              <form.Subscribe selector={(state) => state.values}>
                {(values) => {
                  const { totalCostSol, distributionWallets } =
                    calculateLaunchTotals(values);
                  return (
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
                          <span className="text-foreground line-clamp-2">
                            {values.description || "-"}
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

                      <div className="border-t pt-4">
                        <div className="text-sm font-medium mb-3">
                          Launch Configuration
                        </div>
                        <div className="grid gap-3 text-sm">
                          <div className="grid grid-cols-[140px_1fr] gap-2">
                            <span className="text-muted-foreground">
                              Dev Wallet
                            </span>
                            <span>
                              {values.devWalletOption === "import"
                                ? "Imported wallet"
                                : values.devWalletOption === "generate"
                                  ? "Will be generated"
                                  : "Main wallet"}
                            </span>
                          </div>
                          <div className="grid grid-cols-[140px_1fr] gap-2">
                            <span className="text-muted-foreground">
                              Dev Buy
                            </span>
                            <span>{values.devBuyAmountSol.toFixed(4)} SOL</span>
                          </div>
                          <div className="grid grid-cols-[140px_1fr] gap-2">
                            <span className="text-muted-foreground">
                              Jito Tip
                            </span>
                            <span>
                              {values.jitoTipAmountSol.toFixed(4)} SOL
                            </span>
                          </div>
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
                          {values.vanityMint && (
                            <div className="grid grid-cols-[140px_1fr] gap-2">
                              <span className="text-muted-foreground">
                                Vanity Address
                              </span>
                              <span className="text-green-600">Enabled</span>
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="border-t pt-4">
                        <div className="flex justify-between items-center text-sm">
                          <span className="font-medium">Total Cost</span>
                          <span className="text-lg font-bold">
                            {totalCostSol.toFixed(4)} SOL
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                }}
              </form.Subscribe>
            </CardContent>
          </Card>
          <div className="flex items-center justify-end gap-4">
            {/* <Button
                  type="button"
                  variant="outline"
              onClick={() => {
                form.reset();
                setImagePreview(null);
              }}
                >
                  Reset
            </Button> */}
            <Button
              size={"lg"}
              type="submit"
              form="launch-form"
              className="h-14 px-6 text-4xl font-black tracking-tight shadow-lg shadow-lime-400/10 border border-black hover:shadow-xl hover:shadow-lime-300/20 text-black/90 hover:text-black"
            >
              LAUNCH TOKEN
            </Button>
          </div>
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
        />
      </div>
      <div className="w-80 shrink-0">
        <div className="sticky top-4 border rounded-xl overflow-hidden">
          <nav className="divide-y">
            {steps.map((step, index) => (
              <button
                key={step.id}
                type="button"
                onClick={() => scrollToStep(step.id)}
                className={cn(
                  "w-full text-left px-4 py-4 transition-colors",
                  "hover:bg-accent hover:text-accent-foreground",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
                )}
              >
                <div className="flex items-start gap-4">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 text-sm font-semibold">
                    {index + 1}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-base font-semibold">{step.title}</div>
                    <div className="text-sm text-muted-foreground mt-0.5 leading-snug">
                      {step.description}
                    </div>
                  </div>
                </div>
              </button>
            ))}
          </nav>
        </div>
      </div>
    </div>
  );
}
