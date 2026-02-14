"use client";

import * as React from "react";
import { toast } from "sonner";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@/server/trpc/routers/_app";
import { Badge } from "@/components/ui/badge";
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
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";

type RouterOutputs = inferRouterOutputs<AppRouter>;
type ExitStatusOutput = RouterOutputs["holding"]["exitStatus"];
type ExitActiveOutput = RouterOutputs["holding"]["getActiveExit"];

type ExitData = ExitStatusOutput | ExitActiveOutput | null;

type HoldingExitDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  exit: ExitData;
  tokenSymbol: string;
  totalWallets: number;
  walletsWithBalance: number;
  totalBalance: number;
  isSubmitting?: boolean;
  isCancelling?: boolean;
  onConfirm: (jitoTipSol: number, returnSolToMainWallet: boolean) => Promise<void>;
  onCancel?: () => Promise<void>;
};

const EXIT_CHUNK_SIZE = 20;

const statusVariantMap: Record<
  string,
  "default" | "secondary" | "destructive" | "outline"
> = {
  PENDING: "secondary",
  RUNNING: "default",
  SUCCEEDED: "outline",
  FAILED: "destructive",
};

const statusLabelMap: Record<string, string> = {
  PENDING: "Pending",
  RUNNING: "Running",
  SUCCEEDED: "Succeeded",
  FAILED: "Failed",
};

export function HoldingExitDialog({
  open,
  onOpenChange,
  exit,
  tokenSymbol,
  totalWallets,
  walletsWithBalance,
  totalBalance,
  isSubmitting = false,
  isCancelling = false,
  onConfirm,
  onCancel,
}: HoldingExitDialogProps) {
  const [tip, setTip] = React.useState("0.005");
  const [returnSolToMainWallet, setReturnSolToMainWallet] = React.useState(false);

  React.useEffect(() => {
    if (!open) {
      setTip("0.005");
      setReturnSolToMainWallet(false);
    }
  }, [open]);

  const handleConfirm = async () => {
    const parsed = Number.parseFloat(tip);
    if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
      toast.error("Enter a tip between 0 and 1 SOL");
      return;
    }
    if (walletsWithBalance === 0) {
      toast.error("No wallets with balances available");
      return;
    }
    await onConfirm(parsed, returnSolToMainWallet);
  };

  const status = exit?.status ?? "PENDING";
  const progress = exit?.progress ?? 0;
  const currentStep = exit?.currentStep ?? "Ready";
  const logs = exit?.logs ?? [];
  const canClose =
    status === "SUCCEEDED" || status === "FAILED" || status === "RUNNING";
  const summary = exit?.result as
    | {
        totalWallets?: number;
        totalChunks?: number;
        successfulChunks?: number;
        failedChunks?: number;
        totalTokensUi?: number;
        tokenDecimals?: number;
        bundlesProcessed?: number;
        walletsFunded?: number;
        fundingLamports?: number;
        atasClosed?: number;
        solRecoveredSol?: number;
        totalJitoTipSol?: number;
      }
    | undefined;
  const exitInput = exit?.input as
    | { jitoTipSol?: number; returnSolToMainWallet?: boolean }
    | undefined;
  const parsedTip = Number.parseFloat(tip);
  const localTipSol =
    Number.isFinite(parsedTip) && parsedTip >= 0 ? parsedTip : 0;
  const activeTipSol =
    typeof exitInput?.jitoTipSol === "number" ? exitInput.jitoTipSol : localTipSol;
  const activeReturnSolToMainWallet =
    typeof exitInput?.returnSolToMainWallet === "boolean"
      ? exitInput.returnSolToMainWallet
      : returnSolToMainWallet;
  const estimatedBundles =
    walletsWithBalance > 0 ? Math.ceil(walletsWithBalance / EXIT_CHUNK_SIZE) : 0;
  const estimatedTotalTipSol = activeTipSol * estimatedBundles;

  const showProgress = Boolean(exit);
  const showSummary = status === "SUCCEEDED" && summary;
  const showError = status === "FAILED" && exit?.errorMessage;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto overflow-x-hidden">
        <DialogHeader className="min-w-0">
          <DialogTitle className="flex items-center gap-3">
            Exit Holdings
            {showProgress && (
              <Badge variant={statusVariantMap[status] ?? "secondary"}>
                {statusLabelMap[status] ?? status}
              </Badge>
            )}
          </DialogTitle>
          <DialogDescription className="flex flex-wrap items-center justify-between gap-2">
            <span className="min-w-0 wrap-break-word">{currentStep}</span>
            {showProgress && <span className="shrink-0">{progress}%</span>}
          </DialogDescription>
        </DialogHeader>

        {!showProgress && (
          <div className="space-y-4">
            <div className="grid gap-2">
              <div className="flex items-center justify-between text-sm text-muted-foreground">
                <span>Wallets</span>
                <span className="font-mono">{totalWallets}</span>
              </div>
              <div className="flex items-center justify-between text-sm text-muted-foreground">
                <span>Total balance</span>
                <span className="font-mono">
                  {totalBalance.toFixed(4)} {tokenSymbol}
                </span>
              </div>
              <div className="flex items-center justify-between text-sm text-muted-foreground">
                <span>Wallets with balance</span>
                <span className="font-mono">{walletsWithBalance}</span>
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="exitTip">Jito tip (SOL)</Label>
              <Input
                id="exitTip"
                type="number"
                min="0"
                max="1"
                step="0.0001"
                value={tip}
                onChange={(event) => setTip(event.target.value)}
              />
            </div>
            <div className="flex items-start gap-3 rounded-md border p-3">
              <Checkbox
                id="exitReturnSolToMainWallet"
                checked={returnSolToMainWallet}
                onCheckedChange={(value) => setReturnSolToMainWallet(Boolean(value))}
              />
              <div className="grid gap-1">
                <Label htmlFor="exitReturnSolToMainWallet">
                  Return SOL to main wallet
                </Label>
                <p className="text-xs text-muted-foreground">
                  After exit processing, transfer spendable SOL from processed
                  wallets to your main wallet.
                </p>
              </div>
            </div>
            <div className="rounded-md border p-3 space-y-2 text-xs text-muted-foreground">
              <div className="font-medium text-foreground">What exit does</div>
              <p>1) Collects token balances from all managed wallets with tokens.</p>
              <p>2) Bundles transfers + sell instructions and submits through Jito.</p>
              <p>3) Closes empty token accounts.</p>
              <p>
                4) {returnSolToMainWallet ? "Returns" : "Optionally returns"} SOL from
                processed wallets to main wallet.
              </p>
              <p>
                Jito tip is paid per bundle. Estimated bundles:{" "}
                <span className="font-mono">{estimatedBundles}</span>, estimated total
                tip:{" "}
                <span className="font-mono">{estimatedTotalTipSol.toFixed(4)} SOL</span>.
              </p>
            </div>
          </div>
        )}

        {showProgress && (
          <div className="space-y-4 min-w-0">
            <Progress value={progress} className="w-full" />
            <Separator />
            {showSummary && (
              <div className="rounded-md border border-emerald-500/30 bg-emerald-500/5 p-3 space-y-2">
                <div className="text-sm font-medium text-emerald-700 dark:text-emerald-300">
                  Exit succeeded
                </div>
                <div className="grid gap-2 text-xs text-muted-foreground">
                  <div className="flex items-center justify-between">
                    <span>Total wallets</span>
                    <span className="font-mono">
                      {summary?.totalWallets ?? "-"}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Bundles processed</span>
                    <span className="font-mono">
                      {summary?.bundlesProcessed ?? "-"}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Chunk outcomes</span>
                    <span className="font-mono">
                      {summary?.successfulChunks ?? "-"} ok /{" "}
                      {summary?.failedChunks ?? "-"} failed
                    </span>
                  </div>
                  {(summary?.walletsFunded ?? 0) > 0 && (
                    <div className="flex items-center justify-between">
                      <span>Wallets funded</span>
                      <span className="font-mono">
                        {summary?.walletsFunded} (
                        {((summary?.fundingLamports ?? 0) / 1_000_000_000).toFixed(4)} SOL)
                      </span>
                    </div>
                  )}
                  <div className="flex items-center justify-between">
                    <span>Tokens sold</span>
                    <span className="font-mono">
                      {summary?.totalTokensUi?.toFixed?.(4) ?? "-"}{" "}
                      {tokenSymbol}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>ATAs closed</span>
                    <span className="font-mono">
                      {summary?.atasClosed ?? "-"}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>SOL recovered</span>
                    <span className="font-mono">
                      {summary?.solRecoveredSol?.toFixed?.(4) ?? "-"} SOL
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Total Jito tip</span>
                    <span className="font-mono">
                      {summary?.totalJitoTipSol?.toFixed?.(4) ?? "-"} SOL
                    </span>
                  </div>
                </div>
              </div>
            )}
            {showError && (
              <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                {exit?.errorMessage}
              </div>
            )}
            <div className="rounded-md border p-3 text-xs text-muted-foreground">
              Tip per bundle:{" "}
              <span className="font-mono">{activeTipSol.toFixed(4)} SOL</span>
              <span className="mx-2">|</span>
              SOL return to main wallet:{" "}
              <span className="font-mono">
                {activeReturnSolToMainWallet ? "Enabled" : "Disabled"}
              </span>
            </div>
            <div className="space-y-2">
              <div className="text-sm font-medium">Activity</div>
              <div className="max-h-72 overflow-y-auto rounded-md border p-3 space-y-2">
                {logs.length ? (
                  logs.map((log) => (
                    <div key={log.id} className="flex items-start gap-3 text-sm">
                      <Badge
                        variant={
                          log.level === "ERROR" ? "destructive" : "secondary"
                        }
                      >
                        {log.level}
                      </Badge>
                      <div className="flex-1 min-w-0">
                        <div className="text-foreground wrap-break-word">
                          {log.message}
                        </div>
                        {log.step && (
                          <div className="text-xs text-muted-foreground wrap-break-word">
                            {log.step}
                          </div>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground shrink-0">
                        {new Date(log.createdAt).toLocaleTimeString()}
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="text-sm text-muted-foreground">
                    Waiting for updates...
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        <DialogFooter>
          {showProgress ? (
            <div className="flex gap-2 w-full justify-end">
              {(status === "PENDING" || status === "RUNNING") && onCancel && (
                <Button
                  variant="destructive"
                  onClick={onCancel}
                  disabled={isCancelling}
                >
                  {isCancelling ? (
                    <>
                      <Spinner className="mr-2 size-4" />
                      Cancelling...
                    </>
                  ) : (
                    "Cancel Exit"
                  )}
                </Button>
              )}
              <Button
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={!canClose && !isCancelling}
              >
                Close
              </Button>
            </div>
          ) : (
            <>
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
                disabled={isSubmitting}
              >
                {isSubmitting ? (
                  <>
                    <Spinner className="mr-2 size-4" />
                    Starting...
                  </>
                ) : (
                  "Exit"
                )}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
