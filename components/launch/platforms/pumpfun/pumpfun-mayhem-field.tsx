"use client";

import type { ReactNode } from "react";
import { Info } from "lucide-react";
import type { LaunchFunnelFormApi } from "@/components/launch/use-launch-funnel-form";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

type PumpfunMayhemFieldProps = {
  form: LaunchFunnelFormApi;
};

function MayhemToggle({
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

/** pump.fun Mayhem Mode — bound to Platform config, shown under Launch Options. */
export function PumpfunMayhemField({ form }: PumpfunMayhemFieldProps) {
  return (
    <form.Field name="config.mayhemMode">
      {(field) => (
        <MayhemToggle
          id="mayhem-mode"
          label="Mayhem Mode"
          tooltip={
            <>
              Adds a pump.fun AI trading agent for the token&apos;s first 24
              hours. Uses Token-2022 and is immutable once launched.{" "}
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
        </MayhemToggle>
      )}
    </form.Field>
  );
}
