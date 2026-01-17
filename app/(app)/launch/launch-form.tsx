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
import { trpc } from "@/lib/trpc/client";
import { useRouter } from "next/navigation";

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
  tokenImage: z.string(),
  twitter: z.string(),
  telegram: z.string(),
  website: z.string(),
  devWalletOption: z.enum(["import", "generate", "use_main"]),
  importedDevWalletKey: z.string(),
  devBuyAmount: z.string(),
  jitoTipAmount: z.string(),
  bundleBuyEnabled: z.boolean(),
  vanityMint: z.boolean(),
  numberOfWallets: z.string(),
  buyAmountPerWallet: z.string(),
  buyAmountVariance: z.string(),
  distributionMultiplier: z.string(),
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

export function LaunchForm() {
  const [imagePreview, setImagePreview] = React.useState<string | null>(null);
  const [showLaunchDialog, setShowLaunchDialog] = React.useState(false);
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const router = useRouter();

  const createTokenMutation = trpc.token.create.useMutation({
    onSuccess: (data) => {
      toast.success("Token created successfully!", {
        description: `Token ${data.name} has been created.`,
      });
      setShowLaunchDialog(false);
      router.push(`/dashboard?token=${data.publicKey}`);
    },
    onError: (error) => {
      toast.error("Failed to create token", {
        description:
          error.message || "An error occurred while creating the token.",
      });
    },
  });

  const scrollToStep = (stepId: string) => {
    const element = document.getElementById(stepId);
    if (element) {
      element.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        const result = reader.result as string;
        setImagePreview(result);
        form.setFieldValue("tokenImage", result);
      };
      reader.readAsDataURL(file);
    }
  };

  const removeImage = () => {
    setImagePreview(null);
    form.setFieldValue("tokenImage", "");
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const form = useForm({
    defaultValues: {
      tokenName: "",
      tokenSymbol: "",
      description: "",
      tokenImage: "",
      twitter: "",
      telegram: "",
      website: "",
      devWalletOption: "generate" as "import" | "generate" | "use_main",
      importedDevWalletKey: "",
      devBuyAmount: "0",
      jitoTipAmount: "0.001",
      bundleBuyEnabled: true,
      vanityMint: false,
      numberOfWallets: "5",
      buyAmountPerWallet: "0.01",
      buyAmountVariance: "20",
      distributionMultiplier: "1",
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

  const handleConfirmLaunch = async () => {
    const values = form.state.values;
    const validation = await formSchema.safeParseAsync(values);
    if (!validation.success) {
      toast.error("Validation failed", {
        description: "Please check your form inputs.",
      });
      return;
    }

    createTokenMutation.mutate({
      tokenName: values.tokenName,
      tokenSymbol: values.tokenSymbol,
      description: values.description,
      tokenImage: values.tokenImage || undefined,
      twitter: values.twitter || undefined,
      telegram: values.telegram || undefined,
      website: values.website || undefined,
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
                  <form.Field
                    name="tokenName"
                    children={(field) => {
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
                  />
                  <form.Field
                    name="tokenSymbol"
                    children={(field) => {
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
                  />
                </div>

                <Field>
                  <FieldLabel>Token Image</FieldLabel>
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
                          <img
                            src={imagePreview}
                            alt="Token preview"
                            className="h-full w-full rounded-xl object-cover"
                          />
                          <button
                            type="button"
                            onClick={removeImage}
                            className="absolute -right-2 -top-2 flex h-6 w-6 items-center justify-center rounded-full bg-destructive text-destructive-foreground shadow-sm hover:bg-destructive/90"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          onClick={() => fileInputRef.current?.click()}
                          className="flex h-full w-full flex-col items-center justify-center gap-1 text-muted-foreground hover:text-foreground"
                        >
                          <ImagePlus className="h-6 w-6" />
                          <span className="text-xs">Upload</span>
                        </button>
                      )}
                    </div>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/png, image/jpeg, image/gif"
                      onChange={handleImageUpload}
                      className="hidden"
                    />
                    <div className="text-sm text-muted-foreground">
                      <p>Recommended: 512x512px</p>
                      <p>Max size: 2MB</p>
                      <p>PNG, JPG, or GIF</p>
                    </div>
                  </div>
                </Field>
                <form.Field
                  name="description"
                  children={(field) => {
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
                />
                <div className="col-span-2 border-t pt-4">
                  <p className="text-sm font-medium mb-3">
                    Social Links (optional)
                  </p>
                  <div className="grid grid-cols-3 gap-4">
                    <form.Field
                      name="twitter"
                      children={(field) => {
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
                    />
                    <form.Field
                      name="telegram"
                      children={(field) => {
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
                    />
                    <form.Field
                      name="website"
                      children={(field) => {
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
                    />
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
                <form.Field
                  name="devWalletOption"
                  children={(field) => (
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
                />
                <form.Subscribe
                  selector={(state) => state.values.devWalletOption}
                  children={(devWalletOption) => (
                    <div className="mt-2 h-9">
                      {devWalletOption === "import" && (
                        <form.Field
                          name="importedDevWalletKey"
                          children={(field) => (
                            <Input
                              className="font-mono text-sm"
                              placeholder="Enter private key..."
                              value={field.state.value}
                              onChange={(e) =>
                                field.handleChange(e.target.value)
                              }
                            />
                          )}
                        />
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
                />
              </Field>

              <div className="grid grid-cols-2 gap-6">
                <form.Field
                  name="devBuyAmount"
                  children={(field) => (
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
                        min="0"
                        max="100"
                        value={field.state.value}
                        onChange={(e) => field.handleChange(e.target.value)}
                        placeholder="0"
                      />
                    </Field>
                  )}
                />
                <form.Field
                  name="jitoTipAmount"
                  children={(field) => (
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
                        onChange={(e) => field.handleChange(e.target.value)}
                        placeholder="0.001"
                      />
                    </Field>
                  )}
                />
              </div>

              <div className="flex items-center space-x-3 pt-2">
                <form.Field
                  name="vanityMint"
                  children={(field) => (
                    <Switch
                      id="vanity-mint"
                      checked={field.state.value}
                      onCheckedChange={field.handleChange}
                    />
                  )}
                />
                <div className="flex items-center gap-2">
                  <Label htmlFor="vanity-mint">Vanity Token Address</Label>
                  <Tooltip>
                    <TooltipTrigger>
                      <Info className="h-4 w-4 text-muted-foreground" />
                    </TooltipTrigger>
                    <TooltipContent>
                      Generate a custom token address starting with "pump"
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
                <form.Field
                  name="bundleBuyEnabled"
                  children={(field) => (
                    <Switch
                      id="bundle-buy"
                      size="lg"
                      checked={field.state.value}
                      onCheckedChange={field.handleChange}
                    />
                  )}
                />
              </div>
            </CardHeader>
            <Separator />
            <CardContent>
              <form.Subscribe
                selector={(state) => state.values.bundleBuyEnabled}
                children={(bundleBuyEnabled) =>
                  bundleBuyEnabled && (
                    <div className="space-y-6">
                      <div className="grid grid-cols-2 gap-6">
                        <form.Field
                          name="numberOfWallets"
                          children={(field) => (
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
                                  field.handleChange(e.target.value)
                                }
                                placeholder="5"
                              />
                              <FieldDescription>
                                How many wallets to use for bundle buy (max 10)
                              </FieldDescription>
                            </Field>
                          )}
                        />
                        <form.Field
                          name="buyAmountPerWallet"
                          children={(field) => (
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
                                  field.handleChange(e.target.value)
                                }
                                placeholder="0.01"
                              />
                              <FieldDescription>
                                Base SOL amount each wallet will spend
                              </FieldDescription>
                            </Field>
                          )}
                        />
                      </div>

                      <div className="grid grid-cols-2 gap-6">
                        <form.Field
                          name="buyAmountVariance"
                          children={(field) => (
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
                                  field.handleChange(e.target.value)
                                }
                                placeholder="20"
                              />
                              <FieldDescription>
                                Random variance applied to each buy (0-50%)
                              </FieldDescription>
                            </Field>
                          )}
                        />
                        <form.Field
                          name="distributionMultiplier"
                          children={(field) => (
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
                                  field.handleChange(e.target.value)
                                }
                                placeholder="1"
                              />
                              <FieldDescription>
                                Multiply wallets after launch (1 = no
                                distribution)
                              </FieldDescription>
                            </Field>
                          )}
                        />
                      </div>

                      <form.Subscribe
                        selector={(state) => ({
                          numberOfWallets: state.values.numberOfWallets,
                          buyAmountPerWallet: state.values.buyAmountPerWallet,
                          distributionMultiplier:
                            state.values.distributionMultiplier,
                        })}
                        children={({
                          numberOfWallets,
                          buyAmountPerWallet,
                          distributionMultiplier,
                        }) => {
                          const wallets = parseInt(numberOfWallets) || 0;
                          const amount = parseFloat(buyAmountPerWallet) || 0;
                          const multiplier =
                            parseInt(distributionMultiplier) || 1;
                          const totalBuy = wallets * amount;
                          const totalWallets = wallets * multiplier;

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
                      />
                    </div>
                  )
                }
              />
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
              <form.Subscribe
                selector={(state) => state.values}
                children={(values) => (
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
                          {values.tokenName || "Token Name"}
                        </p>
                        <p className="text-sm text-muted-foreground">
                          ${values.tokenSymbol || "SYMBOL"}
                        </p>
                      </div>
                    </div>

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
                          <span className="text-muted-foreground">Dev Buy</span>
                          <span>{values.devBuyAmount || "0"} SOL</span>
                        </div>
                        <div className="grid grid-cols-[140px_1fr] gap-2">
                          <span className="text-muted-foreground">
                            Jito Tip
                          </span>
                          <span>{values.jitoTipAmount || "0"} SOL</span>
                        </div>
                        {values.bundleBuyEnabled && (
                          <>
                            <div className="grid grid-cols-[140px_1fr] gap-2">
                              <span className="text-muted-foreground">
                                Bundle Buy
                              </span>
                              <span>
                                {values.numberOfWallets} wallets ×{" "}
                                {values.buyAmountPerWallet} SOL (±
                                {values.buyAmountVariance}%)
                              </span>
                            </div>
                            {parseInt(values.distributionMultiplier) > 1 && (
                              <div className="grid grid-cols-[140px_1fr] gap-2">
                                <span className="text-muted-foreground">
                                  Distribution
                                </span>
                                <span>
                                  {parseInt(values.numberOfWallets || "0") *
                                    parseInt(
                                      values.distributionMultiplier || "1"
                                    )}{" "}
                                  wallets after ×{values.distributionMultiplier}{" "}
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
                          {(
                            parseFloat(values.devBuyAmount || "0") +
                            (values.bundleBuyEnabled
                              ? parseInt(values.numberOfWallets || "0") *
                                parseFloat(values.buyAmountPerWallet || "0")
                              : 0) +
                            parseFloat(values.jitoTipAmount || "0")
                          ).toFixed(4)}{" "}
                          SOL
                        </span>
                      </div>
                    </div>
                  </div>
                )}
              />
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
          formValues={form.state.values}
          imagePreview={imagePreview}
          isLoading={createTokenMutation.isPending}
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
