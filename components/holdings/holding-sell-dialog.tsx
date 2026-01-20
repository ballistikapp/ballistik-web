"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
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
  onConfirm: (sellPercentage: number) => Promise<void>;
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

  useEffect(() => {
    if (!open) {
      setPercentage("100");
    }
  }, [open]);

  const totalBalance = useMemo(
    () =>
      holdings.reduce(
        (sum, holding) => sum + (Number.isFinite(holding.tokenBalance) ? holding.tokenBalance : 0),
        0
      ),
    [holdings]
  );

  const handleConfirm = async () => {
    const parsed = Number.parseFloat(percentage);
    if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 100) {
      toast.error("Enter a percentage between 1 and 100");
      return;
    }
    if (holdings.length === 0) {
      toast.error("Select at least one holding");
      return;
    }
    await onConfirm(parsed);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
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
              onChange={(event) => setPercentage(event.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
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
