"use client";

import * as React from "react";
import { Copy, Loader2 } from "lucide-react";
import { LaunchForm } from "./launch-form";
import { CloneTokenDialog } from "./clone-token-dialog";
import { PageHeader } from "@/components/layout/sections";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { trpc } from "@/lib/trpc/client";
import {
  getLaunchPresetName,
  getLaunchPresetValues,
} from "@/lib/config/launch-presets.config";
import { useSearchParams } from "next/navigation";

export default function LaunchPage() {
  const searchParams = useSearchParams();
  const presetName = getLaunchPresetName(searchParams.get("preset"));
  const presetValues = React.useMemo(
    () => getLaunchPresetValues(presetName),
    [presetName]
  );
  const [cloneDialogOpen, setCloneDialogOpen] = React.useState(false);
  const [cloneValues, setCloneValues] = React.useState<Record<
    string,
    unknown
  > | null>(null);
  const [formKey, setFormKey] = React.useState(0);
  const { data: launches, isLoading: isLoadingLaunches } =
    trpc.launch.getUserLaunches.useQuery();

  const hasTokens =
    launches?.some((launch) => Boolean(launch.tokenPublicKey)) ?? false;
  const isPassive = !isLoadingLaunches && !hasTokens;

  const handleClone = (input: Record<string, unknown>) => {
    setCloneValues(input);
    setFormKey((k) => k + 1);
  };
  const initialValues = React.useMemo(
    () => ({ ...presetValues, ...(cloneValues ?? {}) }),
    [presetValues, cloneValues]
  );

  return (
    <div className="flex flex-col gap-12">
      <PageHeader
        title="New Token Launch"
        className="flex-row items-center gap-3"
        actions={
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="inline-flex">
                <Button
                  size="lg"
                  variant="outline"
                  className={`relative shrink-0 ${isPassive ? "opacity-40 pointer-events-none" : ""}`}
                  disabled={isPassive}
                  onClick={() => setCloneDialogOpen(true)}
                >
                  {isLoadingLaunches && (
                    <Loader2 className="absolute size-4 animate-spin" />
                  )}
                  <Copy
                    className={`size-4 mr-2 ${isLoadingLaunches ? "opacity-0" : isPassive ? "" : "text-primary"}`}
                  />
                  <span className={isLoadingLaunches ? "opacity-0" : ""}>
                    Clone Token
                  </span>
                </Button>
              </span>
            </TooltipTrigger>
            {isPassive && (
              <TooltipContent>
                No previous tokens to clone
              </TooltipContent>
            )}
          </Tooltip>
        }
      />

      <LaunchForm key={`${presetName}-${formKey}`} initialValues={initialValues} />

      <CloneTokenDialog
        open={cloneDialogOpen}
        onOpenChange={setCloneDialogOpen}
        onClone={handleClone}
      />
    </div>
  );
}
