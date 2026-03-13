"use client";

import * as React from "react";
import { Copy } from "lucide-react";
import { LaunchForm } from "./launch-form";
import { CloneTokenDialog } from "./clone-token-dialog";
import { PageHeader } from "@/components/layout/sections";
import { Button } from "@/components/ui/button";
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
  const { data: launches } = trpc.launch.getUserLaunches.useQuery();

  const hasTokens = launches?.some((launch) => Boolean(launch.tokenPublicKey)) ?? false;

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
        actions={
          hasTokens ? (
            <Button
              size="lg"
              variant="outline"
              onClick={() => setCloneDialogOpen(true)}
            >
              <Copy className="size-4 mr-2 text-primary" />
              Clone Token
            </Button>
          ) : null
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
