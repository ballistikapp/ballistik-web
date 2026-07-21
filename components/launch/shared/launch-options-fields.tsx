"use client";

import type { ReactNode } from "react";
import { Info } from "lucide-react";
import {
  PageSection,
  PageSectionHeader,
} from "@/components/layout/sections";
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

type LaunchOptionsFieldsProps = {
  form: LaunchFunnelFormApi;
  getIsInvalid?: (field: FunnelFieldState) => boolean;
};

function OptionsToggle({
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

/** Shared Launch Options — vanity mint and Launch Attribution removal. */
export function LaunchOptionsFields({ form }: LaunchOptionsFieldsProps) {
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
                label="Remove Ballistik attribution (+0.1 SOL)"
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
        </div>
      </PageSection>
    </section>
  );
}
