"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc/client";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type OpsRevealButtonProps = {
  targetType: "wallet" | "mint";
  publicKey: string;
  label?: string;
};

export function OpsRevealButton({
  targetType,
  publicKey,
  label = "Reveal key",
}: OpsRevealButtonProps) {
  const [open, setOpen] = useState(false);
  const [privateKey, setPrivateKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reveal = trpc.ops.revealPrivateKey.useMutation({
    onSuccess(data) {
      setPrivateKey(data.privateKey);
      setError(null);
      setOpen(true);
    },
    onError(err) {
      setPrivateKey(null);
      setError(err.message);
      setOpen(true);
    },
  });

  return (
    <>
      <Button
        type="button"
        size="xs"
        variant="outline"
        disabled={reveal.isPending}
        onClick={() => {
          setPrivateKey(null);
          setError(null);
          reveal.mutate({ targetType, publicKey });
        }}
      >
        {reveal.isPending ? "Revealing…" : label}
      </Button>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) {
            setPrivateKey(null);
            setError(null);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Private key reveal</DialogTitle>
            <DialogDescription>
              {targetType === "mint" ? "Mint" : "Wallet"} {publicKey}
            </DialogDescription>
          </DialogHeader>
          {error ? (
            <p className="text-destructive text-sm">{error}</p>
          ) : (
            <pre className="bg-muted overflow-x-auto rounded-md p-3 text-xs break-all whitespace-pre-wrap">
              {privateKey}
            </pre>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
