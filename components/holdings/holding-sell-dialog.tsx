"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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

type HoldingSummary = {
  walletPublicKey: string;
  tokenBalance: number;
};

type HoldingSellDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  holdings: HoldingSummary[];
  tokenSymbol: string;
  isSubmitting?: boolean;
  onConfirm: (
    sellPercentage: number,
    closeAta: boolean,
    returnSolToMainWallet: boolean
  ) => Promise<void>;
};

export function HoldingSellDialog({
  open,
  onOpenChange,
  holdings,
  tokenSymbol,
  isSubmitting = false,
  onConfirm,
}: HoldingSellDialogProps) {
  const [percentage, setPercentage] = useState("100");
  const [closeAta, setCloseAta] = useState(true);
  const [returnSolToMainWallet, setReturnSolToMainWallet] = useState(true);
  const parsedPercentage = Number.parseFloat(percentage);
  const canCloseAta =
    Number.isFinite(parsedPercentage) && parsedPercentage === 100;

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      setPercentage("100");
      setCloseAta(true);
      setReturnSolToMainWallet(true);
    }
    onOpenChange(nextOpen);
  };

  const totalBalance = useMemo(
    () =>
      holdings.reduce(
        (sum, holding) =>
          sum +
          (Number.isFinite(holding.tokenBalance) ? holding.tokenBalance : 0),
        0
      ),
    [holdings]
  );

  const handleConfirm = async () => {
    if (
      !Number.isFinite(parsedPercentage) ||
      parsedPercentage <= 0 ||
      parsedPercentage > 100
    ) {
      toast.error("Enter a percentage between 1 and 100");
      return;
    }
    if (holdings.length === 0) {
      toast.error("Select at least one holding");
      return;
    }
    await onConfirm(
      parsedPercentage,
      canCloseAta && closeAta,
      returnSolToMainWallet
    );
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Sell holdings</DialogTitle>
          <DialogDescription>
            Sell a percentage of the selected holdings.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-2">
            <div className="flex items-center justify-between text-sm text-muted-foreground">
              <span>Selected wallets</span>
              <span className="font-mono">{holdings.length}</span>
            </div>
            <div className="flex items-center justify-between text-sm text-muted-foreground">
              <span>Total balance</span>
              <span className="font-mono">
                {totalBalance.toFixed(4)} {tokenSymbol}
              </span>
            </div>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="sellPercentage">Sell percentage</Label>
            <Input
              id="sellPercentage"
              type="number"
              min="1"
              max="100"
              step="1"
              value={percentage}
              onChange={(event) => {
                const nextPercentage = event.target.value;
                setPercentage(nextPercentage);
                if (Number.parseFloat(nextPercentage) !== 100) {
                  setCloseAta(false);
                }
              }}
            />
          </div>
          <div className="flex items-start gap-3 rounded-md border p-3">
            <Checkbox
              id="closeAta"
              checked={closeAta}
              onCheckedChange={(value) => setCloseAta(Boolean(value))}
              disabled={!canCloseAta}
            />
            <div className="grid gap-1">
              <Label htmlFor="closeAta">Close empty token accounts</Label>
              <p className="text-xs text-muted-foreground">
                Closes associated token accounts when the balance is zero.
                {!canCloseAta ? " Requires 100% sell." : ""}
              </p>
            </div>
          </div>
          <div className="flex items-start gap-3 rounded-md border p-3">
            <Checkbox
              id="returnSolToMainWallet"
              checked={returnSolToMainWallet}
              onCheckedChange={(value) => setReturnSolToMainWallet(Boolean(value))}
            />
            <div className="grid gap-1">
              <Label htmlFor="returnSolToMainWallet">
                Return SOL to main wallet
              </Label>
              <p className="text-xs text-muted-foreground">
                After processing selected wallets, send each processed wallet&apos;s
                spendable SOL balance back to the main wallet.
              </p>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => handleOpenChange(false)}
            disabled={isSubmitting}
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={handleConfirm}
            disabled={isSubmitting || holdings.length === 0}
          >
            {isSubmitting ? "Selling..." : "Sell"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
