"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";

type AccountSendDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

type WalletOption = {
  publicKey: string;
  type: string;
  balanceSol: number;
};

const walletTypeLabel: Record<string, string> = {
  DEV: "Dev",
  BUNDLER: "Bundler",
  VOLUME: "Volume Bot",
  DISTRIBUTION: "Distribution",
};

function truncateKey(key: string) {
  if (key.length <= 12) return key;
  return `${key.slice(0, 4)}...${key.slice(-4)}`;
}

export function AccountSendDialog({
  open,
  onOpenChange,
}: AccountSendDialogProps) {
  const utils = trpc.useUtils();
  const [selectedTokenPk, setSelectedTokenPk] = useState<string>("");
  const [selectedWallets, setSelectedWallets] = useState<Set<string>>(
    new Set()
  );
  const [amount, setAmount] = useState("");

  const { data: tokens, isLoading: tokensLoading } =
    trpc.token.getUserTokens.useQuery(undefined, { enabled: open });

  const { data: operationalData, isLoading: operationalLoading } =
    trpc.wallet.getOperationalByToken.useQuery(
      { tokenPublicKey: selectedTokenPk },
      { enabled: open && !!selectedTokenPk }
    );

  const { data: devWallet, isLoading: devLoading } =
    trpc.wallet.getDevByToken.useQuery(
      { tokenPublicKey: selectedTokenPk },
      { enabled: open && !!selectedTokenPk }
    );

  const sendMutation = trpc.wallet.sendSol.useMutation();

  const walletsLoading = operationalLoading || devLoading;

  const availableWallets: WalletOption[] = useMemo(() => {
    const result: WalletOption[] = [];
    if (devWallet) {
      result.push({
        publicKey: devWallet.publicKey,
        type: devWallet.type,
        balanceSol: Number(devWallet.balanceSol ?? 0),
      });
    }
    if (operationalData?.wallets) {
      for (const w of operationalData.wallets) {
        result.push({
          publicKey: w.publicKey,
          type: w.type,
          balanceSol: Number(w.balanceSol ?? 0),
        });
      }
    }
    return result;
  }, [devWallet, operationalData]);

  const parsedAmount = Number.parseFloat(amount);
  const selectionCount = selectedWallets.size;
  const totalOutflow =
    Number.isFinite(parsedAmount) && parsedAmount > 0 && selectionCount > 0
      ? parsedAmount * selectionCount
      : null;

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      setSelectedTokenPk("");
      setSelectedWallets(new Set());
      setAmount("");
    }
    onOpenChange(nextOpen);
  };

  const handleTokenChange = (value: string) => {
    setSelectedTokenPk(value);
    setSelectedWallets(new Set());
  };

  const handleToggleWallet = (publicKey: string) => {
    setSelectedWallets((prev) => {
      const next = new Set(prev);
      if (next.has(publicKey)) {
        next.delete(publicKey);
      } else {
        next.add(publicKey);
      }
      return next;
    });
  };

  const handleToggleAll = () => {
    if (selectedWallets.size === availableWallets.length) {
      setSelectedWallets(new Set());
    } else {
      setSelectedWallets(new Set(availableWallets.map((w) => w.publicKey)));
    }
  };

  const handleConfirm = async () => {
    if (!selectedTokenPk) {
      toast.error("Select a token");
      return;
    }
    if (selectionCount === 0) {
      toast.error("Select at least one wallet");
      return;
    }
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      toast.error("Enter a valid amount");
      return;
    }

    try {
      const result = await sendMutation.mutateAsync({
        tokenPublicKey: selectedTokenPk,
        walletPublicKeys: Array.from(selectedWallets),
        amountSol: parsedAmount,
      });

      const failedWallets = result.results
        .filter((entry) => entry.status === "FAILED")
        .map((entry) => entry.publicKey);
      const summary = `${result.submittedCount} submitted, ${result.failedCount} failed, ${result.skippedCount} skipped`;
      const failedPreview =
        failedWallets.length > 0 ? failedWallets.slice(0, 3).join(", ") : null;
      const failedSuffix =
        failedPreview && failedWallets.length > 3
          ? `${failedPreview}...`
          : failedPreview;

      if (result.failedCount === 0 && result.skippedCount === 0) {
        toast.success("Send SOL submitted", {
          description: `All wallets processed successfully (${summary}).`,
        });
      } else if (result.submittedCount > 0) {
        toast.message("Send SOL partially submitted", {
          description: failedSuffix
            ? `${summary}. Failed wallets: ${failedSuffix}.`
            : summary,
        });
      } else {
        toast.error("Send SOL failed", {
          description: failedSuffix
            ? `${summary}. Failed wallets: ${failedSuffix}.`
            : summary,
        });
      }

      handleOpenChange(false);
      utils.wallet.getMain.invalidate();
      utils.wallet.getOperationalByToken.invalidate({
        tokenPublicKey: selectedTokenPk,
      });
      utils.wallet.getDevByToken.invalidate({
        tokenPublicKey: selectedTokenPk,
      });
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
          <DialogTitle>Send SOL</DialogTitle>
          <DialogDescription>
            Send SOL from your main wallet to token wallets. Amount is per
            wallet.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label>Token</Label>
            <Select value={selectedTokenPk} onValueChange={handleTokenChange}>
              <SelectTrigger>
                <SelectValue
                  placeholder={
                    tokensLoading ? "Loading tokens..." : "Select a token"
                  }
                />
              </SelectTrigger>
              <SelectContent>
                {tokens?.map((token) => (
                  <SelectItem key={token.publicKey} value={token.publicKey}>
                    {token.symbol} — {token.name}
                  </SelectItem>
                ))}
                {tokens?.length === 0 && (
                  <div className="px-2 py-1.5 text-sm text-muted-foreground">
                    No tokens found
                  </div>
                )}
              </SelectContent>
            </Select>
          </div>

          {selectedTokenPk && (
            <Card size="sm">
              <CardHeader className="flex flex-row items-center justify-between">
                <div className="space-y-1">
                  <CardTitle>Wallets</CardTitle>
                  <CardDescription>
                    {walletsLoading
                      ? "Loading..."
                      : `${availableWallets.length} wallet${availableWallets.length === 1 ? "" : "s"} available`}
                  </CardDescription>
                </div>
                {selectionCount > 0 && (
                  <Badge variant="secondary">{selectionCount} selected</Badge>
                )}
              </CardHeader>
              <CardContent className="grid gap-2">
                {walletsLoading ? (
                  <div className="flex items-center gap-2 py-2 text-sm text-muted-foreground">
                    <Spinner className="size-4" />
                    Loading wallets...
                  </div>
                ) : availableWallets.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No wallets found for this token.
                  </p>
                ) : (
                  <>
                    <div className="flex items-center gap-2 pb-1">
                      <Checkbox
                        id="select-all"
                        checked={
                          selectedWallets.size === availableWallets.length &&
                          availableWallets.length > 0
                        }
                        onCheckedChange={handleToggleAll}
                      />
                      <Label
                        htmlFor="select-all"
                        className="text-sm text-muted-foreground cursor-pointer"
                      >
                        Select all
                      </Label>
                    </div>
                    <div className="max-h-48 overflow-y-auto space-y-1">
                      {availableWallets.map((wallet) => (
                        <label
                          key={wallet.publicKey}
                          className="flex items-center gap-3 rounded-md border px-3 py-2 cursor-pointer hover:bg-muted/50 transition-colors"
                        >
                          <Checkbox
                            checked={selectedWallets.has(wallet.publicKey)}
                            onCheckedChange={() =>
                              handleToggleWallet(wallet.publicKey)
                            }
                          />
                          <div className="flex flex-1 items-center justify-between gap-2 min-w-0">
                            <div className="flex items-center gap-2 min-w-0">
                              <Badge
                                variant="outline"
                                className="shrink-0 text-xs"
                              >
                                {walletTypeLabel[wallet.type] ?? wallet.type}
                              </Badge>
                              <span className="font-mono text-xs text-muted-foreground truncate">
                                {truncateKey(wallet.publicKey)}
                              </span>
                            </div>
                            <span className="font-mono text-xs shrink-0">
                              {wallet.balanceSol.toFixed(4)} SOL
                            </span>
                          </div>
                        </label>
                      ))}
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
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
                placeholder="0.00"
              />
              <InputGroupAddon align="inline-end">SOL</InputGroupAddon>
            </InputGroup>
            {totalOutflow !== null && (
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
            disabled={sendMutation.isPending}
          >
            Cancel
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={
              sendMutation.isPending || !selectedTokenPk || selectionCount === 0
            }
          >
            {sendMutation.isPending ? "Processing..." : "Send SOL"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
