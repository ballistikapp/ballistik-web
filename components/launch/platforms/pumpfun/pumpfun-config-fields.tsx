"use client";

import type { ReactNode } from "react";
import {
  ChevronRight,
  Import,
  Info,
  Sparkles,
  Wallet,
} from "lucide-react";
import {
  PageSection,
  PageSectionDivider,
  PageSectionHeader,
} from "@/components/layout/sections";
import { bundlerWalletCountValidatorMessage } from "@/components/launch/launch-funnel-form-values";
import type {
  FunnelFieldState,
  LaunchFunnelFormApi,
} from "@/components/launch/use-launch-funnel-form";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

type PumpfunConfigFieldsProps = {
  form: LaunchFunnelFormApi;
  getIsInvalid: (field: FunnelFieldState) => boolean;
};

function ConfigToggle({
  id,
  label,
  tooltip,
  children,
}: {
  id: string;
  label: string;
  tooltip: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center space-x-3 pt-1">
      {children}
      <div className="flex items-center gap-2">
        <Label htmlFor={id}>{label}</Label>
        <Tooltip>
          <TooltipTrigger type="button">
            <Info className="h-4 w-4 text-muted-foreground" />
          </TooltipTrigger>
          <TooltipContent className="max-w-xs">{tooltip}</TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
}

export function PumpfunConfigFields({
  form,
  getIsInvalid,
}: PumpfunConfigFieldsProps) {
  return (
    <>
      <section id="pumpfun-options" className="scroll-mt-4">
        <PageSection>
          <PageSectionHeader title="pump.fun Options" />
          <div className="space-y-3">
            <form.Field name="config.vanityMint">
              {(field) => (
                <ConfigToggle
                  id="vanity-mint"
                  label="Vanity Token Address"
                  tooltip='Generate a custom token address ending with "pump".'
                >
                  <Switch
                    id="vanity-mint"
                    checked={field.state.value}
                    onCheckedChange={field.handleChange}
                  />
                </ConfigToggle>
              )}
            </form.Field>
            <form.Field name="config.removeAttribution">
              {(field) => (
                <ConfigToggle
                  id="remove-attribution"
                  label="Remove Ballistik attribution (+0.1 SOL)"
                  tooltip='By default, token descriptions include "Launched with ballistik.app". Enable this to remove it.'
                >
                  <Switch
                    id="remove-attribution"
                    checked={field.state.value}
                    onCheckedChange={field.handleChange}
                  />
                </ConfigToggle>
              )}
            </form.Field>
            <form.Field name="config.mayhemMode">
              {(field) => (
                <ConfigToggle
                  id="mayhem-mode"
                  label="Mayhem Mode"
                  tooltip={
                    <>
                      Adds a pump.fun AI trading agent for the token&apos;s first
                      24 hours. Uses Token-2022 and is immutable once launched.{" "}
                      <span className="font-medium text-amber-500">
                        Beta; pump.fun may disable it at any time.
                      </span>
                    </>
                  }
                >
                  <Switch
                    id="mayhem-mode"
                    checked={field.state.value}
                    onCheckedChange={field.handleChange}
                  />
                </ConfigToggle>
              )}
            </form.Field>
          </div>
        </PageSection>
      </section>

      <PageSectionDivider />

      <section id="launch-settings" className="scroll-mt-4">
        <PageSection>
          <PageSectionHeader title="Dev Wallet Settings" />
          <div className="space-y-6">
            <Field>
              <div className="mb-1 flex items-center gap-2">
                <FieldLabel>Dev Wallet</FieldLabel>
                <Tooltip>
                  <TooltipTrigger type="button">
                    <Info className="h-4 w-4 text-muted-foreground" />
                  </TooltipTrigger>
                  <TooltipContent>
                    Wallet that owns the token and makes the dev buy.
                  </TooltipContent>
                </Tooltip>
              </div>
              <form.Field name="config.devWalletOption">
                {(field) => (
                  <div className="flex flex-wrap gap-2">
                    {(
                      [
                        ["generate", "Generate", Sparkles],
                        ["import", "Import", Import],
                        ["use_main", "Main Wallet", Wallet],
                      ] as const
                    ).map(([value, label, Icon]) => (
                      <button
                        key={value}
                        type="button"
                        onClick={() => field.handleChange(value)}
                        className={cn(
                          "flex items-center gap-2 rounded-md border px-3 py-2 text-sm transition-all",
                          field.state.value === value
                            ? "border-primary bg-primary/5 font-medium"
                            : "border-muted hover:border-muted-foreground/50"
                        )}
                      >
                        <Icon className="h-4 w-4" />
                        {label}
                      </button>
                    ))}
                  </div>
                )}
              </form.Field>
              <form.Subscribe
                selector={(state) => state.values.config.devWalletOption}
              >
                {(devWalletOption) => (
                  <div className="mt-2 min-h-9">
                    {devWalletOption === "import" && (
                      <form.Field name="config.importedDevWalletKey">
                        {(field) => {
                          const isInvalid = getIsInvalid(field);
                          return (
                            <Field data-invalid={isInvalid}>
                              <Input
                                className="font-mono text-sm"
                                placeholder="Enter private key..."
                                value={field.state.value}
                                onBlur={field.handleBlur}
                                onChange={(event) =>
                                  field.handleChange(event.target.value)
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
                      <p className="flex h-9 items-center text-sm text-muted-foreground">
                        A new wallet will be generated for dev operations.
                      </p>
                    )}
                    {devWalletOption === "use_main" && (
                      <p className="flex h-9 items-center text-sm text-muted-foreground">
                        Your main wallet will be used as the dev wallet.
                      </p>
                    )}
                  </div>
                )}
              </form.Subscribe>
            </Field>

            <form.Field name="config.devBuyAmountSol">
              {(field) => {
                const isInvalid = getIsInvalid(field);
                return (
                  <Field data-invalid={isInvalid}>
                    <FieldLabel htmlFor={field.name}>
                      Dev Buy Amount (SOL)
                    </FieldLabel>
                    <Input
                      id={field.name}
                      type="number"
                      step="0.0001"
                      min="0.05"
                      max="100"
                      value={field.state.value}
                      onBlur={field.handleBlur}
                      onChange={(event) =>
                        field.handleChange(event.target.valueAsNumber || 0)
                      }
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

      <section id="bundler-settings" className="scroll-mt-4">
        <PageSection>
          <PageSectionHeader
            title="Bundler Settings"
            className="flex-row items-center justify-between gap-3"
            meta={
              <div className="flex items-center gap-2">
                <Tooltip>
                  <TooltipTrigger type="button">
                    <Info className="h-4 w-4 text-muted-foreground" />
                  </TooltipTrigger>
                  <TooltipContent>
                    Buy tokens in the same Jito bundle as token creation.
                  </TooltipContent>
                </Tooltip>
                <form.Field name="config.bundleBuyEnabled">
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
          <form.Subscribe
            selector={(state) => state.values.config.bundleBuyEnabled}
          >
            {(bundleBuyEnabled) =>
              bundleBuyEnabled && (
                <div className="space-y-6">
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2 md:gap-6">
                    <form.Field
                      name="config.bundlerWalletCount"
                      validators={{
                        onChange: ({ value }) =>
                          bundlerWalletCountValidatorMessage(value),
                        onBlur: ({ value }) =>
                          bundlerWalletCountValidatorMessage(value),
                        onSubmit: ({ value }) =>
                          bundlerWalletCountValidatorMessage(value),
                        onChangeListenTo: ["config.bundleBuyEnabled"],
                      }}
                    >
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
                              max="8"
                              value={field.state.value}
                              onBlur={field.handleBlur}
                              onChange={(event) =>
                                field.handleChange(
                                  event.target.valueAsNumber || 0
                                )
                              }
                              aria-invalid={isInvalid}
                            />
                            <FieldDescription>
                              How many wallets to use for bundle buy (max 8)
                            </FieldDescription>
                            {isInvalid && (
                              <FieldError errors={field.state.meta.errors} />
                            )}
                          </Field>
                        );
                      }}
                    </form.Field>
                    <form.Field name="config.bundlerBuyAmountSol">
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
                              min="0.05"
                              value={field.state.value}
                              onBlur={field.handleBlur}
                              onChange={(event) =>
                                field.handleChange(
                                  event.target.valueAsNumber || 0
                                )
                              }
                              aria-invalid={isInvalid}
                            />
                            <FieldDescription>
                              Base SOL amount each wallet will spend
                            </FieldDescription>
                            {isInvalid && (
                              <FieldError errors={field.state.meta.errors} />
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
                        className="group flex w-full items-center gap-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
                      >
                        <ChevronRight className="h-4 w-4 transition-transform group-data-[state=open]:rotate-90" />
                        Advanced Settings
                      </button>
                    </CollapsibleTrigger>
                    <CollapsibleContent className="pt-4">
                      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 md:gap-6">
                        <form.Field name="config.bundlerBuyVariancePercent">
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
                                onBlur={field.handleBlur}
                                onChange={(event) =>
                                  field.handleChange(
                                    event.target.valueAsNumber || 0
                                  )
                                }
                              />
                              <FieldDescription>
                                Random variance applied to each buy (0-50%)
                              </FieldDescription>
                            </Field>
                          )}
                        </form.Field>
                        <form.Field name="config.distributionWalletMultiplier">
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
                                onBlur={field.handleBlur}
                                onChange={(event) =>
                                  field.handleChange(
                                    event.target.valueAsNumber || 1
                                  )
                                }
                              />
                              <FieldDescription>
                                Multiply wallets after launch (1 = none)
                              </FieldDescription>
                            </Field>
                          )}
                        </form.Field>
                      </div>
                      <form.Field name="config.jitoTipAmountSol">
                        {(field) => (
                          <Field className="mt-6">
                            <FieldLabel htmlFor={field.name}>
                              Jito Tip Amount (SOL)
                            </FieldLabel>
                            <Input
                              id={field.name}
                              type="number"
                              step="0.0001"
                              min="0"
                              max="1"
                              value={field.state.value}
                              onBlur={field.handleBlur}
                              onChange={(event) =>
                                field.handleChange(
                                  event.target.valueAsNumber || 0
                                )
                              }
                            />
                          </Field>
                        )}
                      </form.Field>
                    </CollapsibleContent>
                  </Collapsible>

                  <form.Subscribe
                    selector={(state) => ({
                      count: state.values.config.bundlerWalletCount,
                      buy: state.values.config.bundlerBuyAmountSol,
                      multiplier:
                        state.values.config.distributionWalletMultiplier,
                    })}
                  >
                    {({ count, buy, multiplier }) => (
                      <div className="rounded-lg border bg-muted/50 p-4">
                        <div className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-2">
                          <div>
                            <span className="text-muted-foreground">
                              Total Bundle Buy
                            </span>
                            <p className="text-lg font-semibold">
                              {(count * buy).toFixed(4)} SOL
                            </p>
                          </div>
                          <div>
                            <span className="text-muted-foreground">
                              Total Wallets After Distribution
                            </span>
                            <p className="text-lg font-semibold">
                              {count * multiplier} wallets
                            </p>
                          </div>
                        </div>
                      </div>
                    )}
                  </form.Subscribe>
                </div>
              )
            }
          </form.Subscribe>
        </PageSection>
      </section>
    </>
  );
}
