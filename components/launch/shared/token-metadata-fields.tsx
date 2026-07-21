"use client";

import type { ChangeEvent, RefObject } from "react";
import { ImagePlus, X } from "lucide-react";
import {
  Field,
  FieldError,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupText,
  InputGroupTextarea,
} from "@/components/ui/input-group";
import { cn } from "@/lib/utils";
import type {
  FunnelFieldState,
  LaunchFunnelFormApi,
} from "@/components/launch/use-launch-funnel-form";

export type { FunnelFieldState };

type TokenMetadataFieldsProps = {
  form: LaunchFunnelFormApi;
  getIsInvalid: (field: FunnelFieldState) => boolean;
  imagePreview: string | null;
  bannerPreview: string | null;
  mainMediaInputRef: RefObject<HTMLInputElement | null>;
  bannerInputRef: RefObject<HTMLInputElement | null>;
  onMainMediaUpload: (event: ChangeEvent<HTMLInputElement>) => void;
  onBannerUpload: (event: ChangeEvent<HTMLInputElement>) => void;
  onRemoveMainMedia: () => void;
  onRemoveBanner: () => void;
};

export function TokenMetadataFields({
  form,
  getIsInvalid,
  imagePreview,
  bannerPreview,
  mainMediaInputRef,
  bannerInputRef,
  onMainMediaUpload,
  onBannerUpload,
  onRemoveMainMedia,
  onRemoveBanner,
}: TokenMetadataFieldsProps) {
  const isVideoPreview = Boolean(imagePreview?.startsWith("data:video"));

  return (
    <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-2 lg:gap-8">
      <div className="space-y-4">
        <form.Field name="metadata.tokenName">
          {(field) => {
            const isInvalid = getIsInvalid(field);
            return (
              <Field data-invalid={isInvalid}>
                <FieldLabel htmlFor={field.name}>Token Name</FieldLabel>
                <Input
                  id={field.name}
                  name={field.name}
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                  aria-invalid={isInvalid}
                  placeholder="My Token"
                  autoComplete="off"
                />
                {isInvalid && <FieldError errors={field.state.meta.errors} />}
              </Field>
            );
          }}
        </form.Field>
        <form.Field name="metadata.tokenSymbol">
          {(field) => {
            const isInvalid = getIsInvalid(field);
            return (
              <Field data-invalid={isInvalid}>
                <FieldLabel htmlFor={field.name}>Token Symbol</FieldLabel>
                <Input
                  id={field.name}
                  name={field.name}
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(event) =>
                    field.handleChange(event.target.value.toUpperCase())
                  }
                  aria-invalid={isInvalid}
                  placeholder="MTK"
                  autoComplete="off"
                />
                {isInvalid && <FieldError errors={field.state.meta.errors} />}
              </Field>
            );
          }}
        </form.Field>
        <form.Field name="metadata.description">
          {(field) => {
            const isInvalid = getIsInvalid(field);
            return (
              <Field data-invalid={isInvalid}>
                <FieldLabel htmlFor={field.name}>Description</FieldLabel>
                <InputGroup>
                  <InputGroupTextarea
                    id={field.name}
                    name={field.name}
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(event) => field.handleChange(event.target.value)}
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
                {isInvalid && <FieldError errors={field.state.meta.errors} />}
              </Field>
            );
          }}
        </form.Field>
      </div>

      <div className="space-y-6">
        <form.Field name="metadata.tokenImage">
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
                          onClick={onRemoveMainMedia}
                          className="absolute -right-2 -top-2 flex h-6 w-6 items-center justify-center rounded-full bg-destructive text-destructive-foreground shadow-sm hover:bg-destructive/90"
                          aria-label="Remove main media"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        onClick={() => mainMediaInputRef.current?.click()}
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
                    onChange={onMainMediaUpload}
                    className="hidden"
                  />
                  <div className="space-y-1 text-sm text-muted-foreground">
                    <p className="font-medium text-foreground">
                      File size and type
                    </p>
                    <p>Image - max 15MB. JPG, GIF or PNG recommended</p>
                    <p>Video - max 30MB. MP4 recommended</p>
                    <p className="pt-2 font-medium text-foreground">
                      Resolution and aspect ratio
                    </p>
                    <p>Image - 1:1 square recommended (1000x1000px+)</p>
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

        <form.Field name="metadata.tokenBanner">
          {() => (
            <Field>
              <FieldLabel>Banner</FieldLabel>
              <div className="flex flex-col items-start gap-4 sm:flex-row">
                <div
                  className={cn(
                    "relative flex h-24 w-full max-w-72 shrink-0 items-center justify-center rounded-xl border-2 border-dashed transition-colors",
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
                        onClick={onRemoveBanner}
                        className="absolute -right-2 -top-2 flex h-6 w-6 items-center justify-center rounded-full bg-destructive text-destructive-foreground shadow-sm hover:bg-destructive/90"
                        aria-label="Remove banner"
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
                  onChange={onBannerUpload}
                  className="hidden"
                />
                <div className="space-y-1 text-sm text-muted-foreground">
                  <p>Optional; only available during creation.</p>
                  <p>JPG, GIF or PNG; max 4.3MB.</p>
                  <p>3:1 aspect ratio, at least 1500x500px.</p>
                </div>
              </div>
            </Field>
          )}
        </form.Field>

        <div className="pt-2">
          <p className="mb-3 text-sm font-medium">Social Links</p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {(
              [
                ["metadata.twitter", "Twitter/X", "https://twitter.com/yourtoken"],
                ["metadata.telegram", "Telegram", "https://t.me/yourtoken"],
                ["metadata.website", "Website", "https://yourtoken.com"],
              ] as const
            ).map(([name, label, placeholder]) => (
              <form.Field key={name} name={name}>
                {(field) => {
                  const isInvalid = getIsInvalid(field);
                  return (
                    <Field data-invalid={isInvalid}>
                      <FieldLabel htmlFor={field.name}>{label}</FieldLabel>
                      <Input
                        id={field.name}
                        name={field.name}
                        value={field.state.value}
                        onBlur={field.handleBlur}
                        onChange={(event) =>
                          field.handleChange(event.target.value)
                        }
                        aria-invalid={isInvalid}
                        placeholder={placeholder}
                        autoComplete="off"
                      />
                      {isInvalid && (
                        <FieldError errors={field.state.meta.errors} />
                      )}
                    </Field>
                  );
                }}
              </form.Field>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
