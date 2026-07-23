"use client";

import type { ReactNode } from "react";
import { Info } from "lucide-react";
import { PageSection, PageSectionHeader } from "@/components/layout/sections";
import { LaunchFeeBadge } from "@/components/launch/shared/launch-fee-badge";
import type {
  FunnelFieldState,
  LaunchFunnelFormApi,
} from "@/components/launch/use-launch-funnel-form";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  descriptionAttributionRemovalFeeSol,
  vanityMintFeeSol,
} from "@/lib/config/usage-fees.config";

type LaunchOptionsFieldsProps = {
  form: LaunchFunnelFormApi;
  getIsInvalid?: (field: FunnelFieldState) => boolean;
  /** Platform-specific toggles rendered after shared Launch Options. */
  platformOptions?: ReactNode;
};

function OptionsToggle({
  id,
  label,
  tooltip,
  feeSol,
  children,
}: {
  id: string;
  label: string;
  tooltip: ReactNode;
  feeSol?: number;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center space-x-3 pt-1">
      {children}
      <div className="flex items-center gap-2">
        <Label htmlFor={id}>{label}</Label>
        {feeSol != null && <LaunchFeeBadge amountSol={feeSol} />}
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

/** Shared Launch Options — vanity mint and Launch Attribution removal. */
export function LaunchOptionsFields({
  form,
  platformOptions,
}: LaunchOptionsFieldsProps) {
  return (
    <section id="launch-options" className="scroll-mt-4">
      <PageSection>
        <PageSectionHeader title="Launch Options" />
        <div className="space-y-3">
          <form.Field name="options.vanityMint">
            {(field) => (
              <OptionsToggle
                id="vanity-mint"
                label="Vanity Token Address"
                feeSol={vanityMintFeeSol}
                tooltip='Generate a custom token address ending with "pump".'
              >
                <Switch
                  id="vanity-mint"
                  checked={field.state.value}
                  onCheckedChange={field.handleChange}
                />
              </OptionsToggle>
            )}
          </form.Field>
          <form.Field name="options.removeAttribution">
            {(field) => (
              <OptionsToggle
                id="remove-attribution"
                label="Remove Ballistik attribution"
                feeSol={descriptionAttributionRemovalFeeSol}
                tooltip='By default, token descriptions include "Launched with ballistik.app". Enable this to remove it.'
              >
                <Switch
                  id="remove-attribution"
                  checked={field.state.value}
                  onCheckedChange={field.handleChange}
                />
              </OptionsToggle>
            )}
          </form.Field>
          {platformOptions}
        </div>
      </PageSection>
    </section>
  );
}
