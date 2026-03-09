"use client";

import { IconCopy } from "@tabler/icons-react";
import { QRCodeSVG } from "qrcode.react";
import { copyToClipboard } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type MainWalletDepositDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  publicKey: string;
};

export function MainWalletDepositDialog({
  open,
  onOpenChange,
  publicKey,
}: MainWalletDepositDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Deposit SOL</DialogTitle>
          <DialogDescription>
            Send funds to this main wallet address to use the app.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="flex justify-center rounded-md border bg-white p-3">
            <QRCodeSVG value={publicKey} size={180} />
          </div>

          <div className="space-y-2">
            <p className="text-xs uppercase tracking-tighter font-mono font-semibold text-muted-foreground">
              Main wallet public key
            </p>
            <div className="rounded-md border bg-muted/30 p-3">
              <code className="break-all font-mono text-xs">{publicKey}</code>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => void copyToClipboard(publicKey, "Public key")}
          >
            <IconCopy className="size-4" />
            Copy public key
          </Button>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
