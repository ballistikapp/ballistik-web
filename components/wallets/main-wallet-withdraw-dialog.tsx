"use client";

import { useMemo, useState } from "react";
import { PublicKey } from "@solana/web3.js";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc/client";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

type MainWalletWithdrawDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  balanceSol: number;
};

function isValidPublicKey(value: string) {
  try {
    new PublicKey(value);
    return true;
  } catch {
    return false;
  }
}

export function MainWalletWithdrawDialog({
  open,
  onOpenChange,
  balanceSol,
}: MainWalletWithdrawDialogProps) {
  const utils = trpc.useUtils();
  const withdrawMutation = trpc.wallet.withdrawMainSol.useMutation();
  const [destinationPublicKey, setDestinationPublicKey] = useState("");
  const [amountInput, setAmountInput] = useState("");
  const [useMax, setUseMax] = useState(false);
  const [step, setStep] = useState<"form" | "review">("form");
  const [confirmOpen, setConfirmOpen] = useState(false);

  const parsedAmount = Number.parseFloat(amountInput);
  const reviewAmount = useMax
    ? "Max (all available SOL minus network fee)"
    : `${Number.isFinite(parsedAmount) ? parsedAmount.toFixed(6) : "0.000000"} SOL`;

  const canContinue = useMemo(() => {
    if (!isValidPublicKey(destinationPublicKey.trim())) {
      return false;
    }
    if (useMax) {
      return true;
    }
    return Number.isFinite(parsedAmount) && parsedAmount > 0;
  }, [destinationPublicKey, parsedAmount, useMax]);

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      setDestinationPublicKey("");
      setAmountInput("");
      setUseMax(false);
      setStep("form");
      setConfirmOpen(false);
      withdrawMutation.reset();
    }
    onOpenChange(nextOpen);
  };

  const handleContinue = () => {
    const destination = destinationPublicKey.trim();
    if (!isValidPublicKey(destination)) {
      toast.error("Enter a valid destination wallet address");
      return;
    }
    if (!useMax && (!Number.isFinite(parsedAmount) || parsedAmount <= 0)) {
      toast.error("Enter a valid withdraw amount");
      return;
    }
    setDestinationPublicKey(destination);
    setStep("review");
  };

  const handleSubmit = async () => {
    try {
      const result = await withdrawMutation.mutateAsync({
        destinationPublicKey,
        amountSol: useMax ? undefined : parsedAmount,
        useMax,
      });
      toast.success("Withdraw submitted", {
        description: `${result.amountSol.toFixed(6)} SOL sent.`,
      });
      await utils.wallet.getMain.invalidate();
      handleOpenChange(false);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to submit withdraw";
      toast.error(message);
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Withdraw SOL</DialogTitle>
            <DialogDescription>
              Send SOL from your main wallet to an external wallet.
            </DialogDescription>
          </DialogHeader>

          {step === "form" ? (
            <div className="grid gap-4">
              <div className="rounded-md border bg-muted/20 p-3 text-sm">
                Current balance:{" "}
                <span className="font-mono">{balanceSol.toFixed(6)} SOL</span>
              </div>

              <div className="grid gap-2">
                <Label htmlFor="withdraw-destination">Destination wallet</Label>
                <Input
                  id="withdraw-destination"
                  value={destinationPublicKey}
                  onChange={(event) => setDestinationPublicKey(event.target.value)}
                  placeholder="Enter destination public key"
                  autoComplete="off"
                />
              </div>

              <div className="grid gap-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="withdraw-amount">Amount (SOL)</Label>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setUseMax(true);
                      setAmountInput("");
                    }}
                  >
                    Max
                  </Button>
                </div>
                <Input
                  id="withdraw-amount"
                  type="number"
                  min="0"
                  step="0.000001"
                  inputMode="decimal"
                  value={amountInput}
                  onChange={(event) => {
                    setAmountInput(event.target.value);
                    setUseMax(false);
                  }}
                  placeholder="0.00"
                  disabled={useMax}
                />
                {useMax && (
                  <p className="text-xs text-muted-foreground">
                    Max is selected. The app will send all available SOL minus
                    network fee.
                  </p>
                )}
              </div>
            </div>
          ) : (
            <div className="grid gap-3 rounded-md border p-3">
              <p className="text-sm font-medium">Review withdraw details</p>
              <div className="text-sm">
                <span className="text-muted-foreground">Destination:</span>
                <p className="mt-1 break-all font-mono text-xs">
                  {destinationPublicKey}
                </p>
              </div>
              <div className="text-sm">
                <span className="text-muted-foreground">Amount:</span>{" "}
                <span className="font-medium">{reviewAmount}</span>
              </div>
              <p className="text-sm text-amber-600">
                Double-check destination and amount. This action cannot be
                reversed.
              </p>
            </div>
          )}

          <DialogFooter>
            {step === "form" ? (
              <>
                <Button
                  variant="outline"
                  onClick={() => handleOpenChange(false)}
                  disabled={withdrawMutation.isPending}
                >
                  Cancel
                </Button>
                <Button onClick={handleContinue} disabled={!canContinue}>
                  Continue
                </Button>
              </>
            ) : (
              <>
                <Button
                  variant="outline"
                  onClick={() => setStep("form")}
                  disabled={withdrawMutation.isPending}
                >
                  Back
                </Button>
                <Button
                  variant="destructive"
                  onClick={() => setConfirmOpen(true)}
                  disabled={withdrawMutation.isPending}
                >
                  Approve & Withdraw
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent size="default">
          <AlertDialogHeader>
            <AlertDialogTitle>Final confirmation</AlertDialogTitle>
            <AlertDialogDescription>
              You are about to send {reviewAmount} to this wallet:
              <span className="mt-1 block break-all font-mono text-xs">
                {destinationPublicKey}
              </span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={withdrawMutation.isPending}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={withdrawMutation.isPending}
              onClick={(event) => {
                event.preventDefault();
                void handleSubmit();
              }}
            >
              {withdrawMutation.isPending ? "Submitting..." : "Confirm Withdraw"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
