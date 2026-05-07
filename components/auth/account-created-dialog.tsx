"use client";

import { IconCopy, IconChevronRight } from "@tabler/icons-react";
import { copyToClipboard } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type AccountCreatedDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mainWalletPublicKey: string;
  onGoToAccount: () => void;
  onGoToApp: () => void;
};

export function AccountCreatedDialog({
  open,
  onOpenChange,
  mainWalletPublicKey,
  onGoToAccount,
  onGoToApp,
}: AccountCreatedDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader className="items-center text-center pt-2 space-y-4">
          <DialogTitle className="text-2xl font-semibold leading-tight">
            Account created
          </DialogTitle>
          <DialogDescription className="text-center">
            We generated a Main Wallet for your account.
            <br />
            Fund it any time from your account.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2 pt-4">
          <p className="text-xs uppercase tracking-tighter font-mono font-semibold text-muted-foreground">
            Main wallet public key
          </p>
          <div className="flex items-center gap-2 rounded-md border bg-muted/30 p-3">
            <code className="flex-1 break-all font-mono text-xs">
              {mainWalletPublicKey}
            </code>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="shrink-0 text-muted-foreground hover:text-foreground"
              onClick={() =>
                void copyToClipboard(mainWalletPublicKey, "Public key")
              }
            >
              <IconCopy className="size-4" />
            </Button>
          </div>
        </div>

        <Button
          type="button"
          size="lg"
          className="w-full h-12 text-base font-semibold group"
          onClick={onGoToApp}
        >
          Go to App
          <IconChevronRight className="size-5 transition-transform group-hover:translate-x-0.5" />
        </Button>
      </DialogContent>
    </Dialog>
  );
}
