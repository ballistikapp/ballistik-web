"use client";

import { useState } from "react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc/client";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

type WalletTransferDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: "send" | "return";
  tokenPublicKey: string;
  walletPublicKeys: string[];
  onSuccess?: () => void;
};

export function WalletTransferDialog({
  open,
  onOpenChange,
  mode,
  tokenPublicKey,
  walletPublicKeys,
  onSuccess,
}: WalletTransferDialogProps) {
  const [amount, setAmount] = useState("");
  const sendMutation = trpc.wallet.sendSol.useMutation();
  const returnMutation = trpc.wallet.returnSol.useMutation();

  const isSending = sendMutation.isPending || returnMutation.isPending;
  const isSendMode = mode === "send";
  const title = isSendMode ? "Send SOL" : "Return SOL";

  const handleConfirm = async () => {
    const parsedAmount = Number.parseFloat(amount);
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      toast.error("Enter a valid amount");
      return;
    }
    if (walletPublicKeys.length === 0) {
      toast.error("Select at least one wallet");
      return;
    }

    try {
      if (isSendMode) {
        await sendMutation.mutateAsync({
          tokenPublicKey,
          walletPublicKeys,
          amountSol: parsedAmount,
        });
      } else {
        await returnMutation.mutateAsync({
          tokenPublicKey,
          walletPublicKeys,
          amountSol: parsedAmount,
        });
      }
      toast.success(`${title} submitted`);
      setAmount("");
      onOpenChange(false);
      onSuccess?.();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to submit transfer";
      toast.error(message);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="text-sm text-muted-foreground">
            {walletPublicKeys.length} wallet
            {walletPublicKeys.length === 1 ? "" : "s"} selected
          </div>
          <Input
            type="number"
            min="0"
            step="0.0001"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            placeholder="Amount in SOL"
          />
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button onClick={handleConfirm} disabled={isSending}>
              {isSending ? "Processing..." : title}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
