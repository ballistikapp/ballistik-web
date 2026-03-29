"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

type WalletSummary = {
  publicKey: string;
  balanceSol?: number | null;
  type?: string | null;
};

type WalletTransferDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: "send" | "return";
  tokenPublicKey: string;
  walletPublicKeys: string[];
  wallets?: WalletSummary[];
  onSuccess?: () => void;
};

export function WalletTransferDialog({
  open,
  onOpenChange,
  mode,
  tokenPublicKey,
  walletPublicKeys,
  wallets,
  onSuccess,
}: WalletTransferDialogProps) {
  const utils = trpc.useUtils();
  const [amount, setAmount] = useState("");
  const [returnOption, setReturnOption] = useState<"amount" | "max">("amount");
  const sendMutation = trpc.wallet.sendSol.useMutation();
  const returnMutation = trpc.wallet.returnSol.useMutation();
  const refreshMainBalance = trpc.wallet.refreshMainBalance.useMutation();

  const isSending = sendMutation.isPending || returnMutation.isPending;
  const isSendMode = mode === "send";
  const isReturnMode = mode === "return";
  const isMax = isReturnMode && returnOption === "max";
  const title = isSendMode ? "Send SOL" : "Return SOL";
  const selectionCount = walletPublicKeys.length;

  const selectedWallets = useMemo(() => {
    if (!wallets?.length) return [];
    const lookup = new Map(wallets.map((wallet) => [wallet.publicKey, wallet]));
    return walletPublicKeys
      .map((publicKey) => lookup.get(publicKey))
      .filter((wallet): wallet is WalletSummary => Boolean(wallet));
  }, [walletPublicKeys, wallets]);

  const numericBalances = selectedWallets
    .map((wallet) => (wallet.balanceSol == null ? NaN : Number(wallet.balanceSol)))
    .filter((value) => Number.isFinite(value));
  const totalBalance = numericBalances.reduce((sum, value) => sum + value, 0);
  const hasBalance = numericBalances.length > 0;
  const hasUnknownBalance =
    selectionCount > 0 &&
    (selectedWallets.length !== selectionCount ||
      numericBalances.length !== selectedWallets.length);
  const totalBalanceLabel =
    selectionCount === 0
      ? "0.0000 SOL"
      : hasBalance
      ? `${totalBalance.toFixed(4)} SOL`
      : "Unavailable";
  const balanceLabel = selectionCount > 1 ? "Total available" : "Available balance";
  const description = isSendMode
    ? "Send SOL from the main wallet to each selected wallet. Amount is per wallet."
    : "Return the maximum available SOL from selected wallets back to the main wallet.";
  const parsedAmount = Number.parseFloat(amount);
  const totalOutflow =
    isSendMode &&
    Number.isFinite(parsedAmount) &&
    parsedAmount > 0 &&
    selectionCount > 0
      ? parsedAmount * selectionCount
      : null;
  const actionLabel = isSendMode ? "send" : "return";

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      setAmount("");
      setReturnOption("amount");
    }
    onOpenChange(nextOpen);
  };

  const handleReturnOptionChange = (value: string) => {
    if (value === "amount" || value === "max") {
      setReturnOption(value);
      if (value === "max" && hasBalance) {
        setAmount(totalBalance.toFixed(4));
      }
    }
  };

  const handleConfirm = async () => {
    const parsedAmount = Number.parseFloat(amount);
    if (!isMax && (!Number.isFinite(parsedAmount) || parsedAmount <= 0)) {
      toast.error("Enter a valid amount");
      return;
    }
    if (walletPublicKeys.length === 0) {
      toast.error("Select at least one wallet");
      return;
    }

    try {
      const result = isSendMode
        ? await sendMutation.mutateAsync({
          tokenPublicKey,
          walletPublicKeys,
          amountSol: parsedAmount,
        })
        : await returnMutation.mutateAsync({
          tokenPublicKey,
          walletPublicKeys,
          amountSol: isMax ? undefined : parsedAmount ?? undefined,
          useMax: isMax,
        });
      const failedWallets = result.results
        .filter((entry) => entry.status === "FAILED")
        .map((entry) => entry.publicKey);
      const summary = `${result.submittedCount} submitted, ${result.failedCount} failed, ${result.skippedCount} skipped`;
      const failedPreview =
        failedWallets.length > 0
          ? failedWallets.slice(0, 3).join(", ")
          : null;
      const failedSuffix =
        failedPreview && failedWallets.length > 3
          ? `${failedPreview}...`
          : failedPreview;
      if (result.failedCount === 0 && result.skippedCount === 0) {
        toast.success(`${title} submitted`, {
          description: `All wallets processed successfully (${summary}).`,
        });
      } else if (result.submittedCount > 0) {
        toast.message(`${title} partially submitted`, {
          description:
            failedSuffix
              ? `${summary}. Failed ${actionLabel} wallets: ${failedSuffix}.`
              : summary,
        });
      } else {
        toast.error(`${title} failed`, {
          description:
            failedSuffix
              ? `${summary}. Failed ${actionLabel} wallets: ${failedSuffix}.`
              : summary,
        });
      }
      setAmount("");
      setReturnOption("amount");
      onOpenChange(false);
      refreshMainBalance.mutateAsync({}).then(() => {
        utils.wallet.getMain.invalidate();
      });
      utils.wallet.getOperationalByToken.invalidate();
      utils.wallet.getDevByToken.invalidate();
      onSuccess?.();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to submit transfer";
      toast.error(message);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <Card size="sm">
            <CardHeader className="flex flex-row items-center justify-between">
              <div className="space-y-1">
                <CardTitle>Selection</CardTitle>
                <CardDescription>
                  {selectionCount} wallet{selectionCount === 1 ? "" : "s"} selected
                </CardDescription>
              </div>
              <Badge variant="secondary">
                {selectionCount === 1 ? "Single" : "Bulk"}
              </Badge>
            </CardHeader>
            <CardContent className="grid gap-2">
              {isReturnMode && (
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">{balanceLabel}</span>
                  <span className="font-mono">{totalBalanceLabel}</span>
                </div>
              )}
              {isReturnMode && selectionCount > 1 && (
                <div className="text-xs text-muted-foreground">
                  Total reflects cached balances. Fees are deducted per wallet.
                </div>
              )}
              {isReturnMode && hasUnknownBalance && (
                <div className="text-xs text-muted-foreground">
                  Some balances are missing. Refresh to update totals.
                </div>
              )}
            </CardContent>
          </Card>

          {isReturnMode && (
            <div className="grid gap-2">
              <Label>Return option</Label>
              <ToggleGroup
                type="single"
                variant="outline"
                value={returnOption}
                onValueChange={handleReturnOptionChange}
                className="w-full"
              >
                <ToggleGroupItem value="amount" className="flex-1">
                  Custom amount
                </ToggleGroupItem>
                <ToggleGroupItem value="max" className="flex-1">
                  Max balance
                </ToggleGroupItem>
              </ToggleGroup>
              <div className="text-xs text-muted-foreground">
                {isMax
                  ? "Returns each wallet's full balance to the main wallet."
                  : "Amount applies to each selected wallet."}
              </div>
            </div>
          )}

          <Separator />

          <div className="grid gap-2">
            <Label>Amount per wallet</Label>
            <InputGroup>
              <InputGroupInput
                type="number"
                min="0"
                step="0.0001"
                inputMode="decimal"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                placeholder={isMax ? "Disabled for max return" : "0.00"}
                disabled={isMax}
              />
              <InputGroupAddon align="inline-end">SOL</InputGroupAddon>
            </InputGroup>
            {isReturnMode && isMax && (
              <div className="text-xs text-muted-foreground">
                Amount input is disabled while max return is selected.
              </div>
            )}
            {isSendMode && totalOutflow !== null && (
              <div className="text-xs text-muted-foreground">
                Total send from main wallet: {totalOutflow.toFixed(4)} SOL
              </div>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => handleOpenChange(false)}
            disabled={isSending}
          >
            Cancel
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={isSending || selectionCount === 0}
          >
            {isSending ? "Processing..." : title}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
