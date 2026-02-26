"use client";

import * as React from "react";
import { Copy } from "lucide-react";
import { LaunchForm } from "./launch-form";
import { CloneTokenDialog } from "./clone-token-dialog";
import { PageHeader } from "@/components/layout/sections";
import { Button } from "@/components/ui/button";

export default function LaunchPage() {
  const [cloneDialogOpen, setCloneDialogOpen] = React.useState(false);
  const [cloneValues, setCloneValues] = React.useState<Record<
    string,
    unknown
  > | null>(null);
  const [formKey, setFormKey] = React.useState(0);

  const handleClone = (input: Record<string, unknown>) => {
    setCloneValues(input);
    setFormKey((k) => k + 1);
  };

  return (
    <div className="flex flex-col gap-12">
      <PageHeader
        title="New Token Launch"
        actions={
          <Button variant="outline" onClick={() => setCloneDialogOpen(true)}>
            <Copy className="size-4" />
            Clone Token
          </Button>
        }
      />

      <LaunchForm key={formKey} initialValues={cloneValues} />

      <CloneTokenDialog
        open={cloneDialogOpen}
        onOpenChange={setCloneDialogOpen}
        onClone={handleClone}
      />
    </div>
  );
}
