"use client";

import * as React from "react";
import { Info } from "lucide-react";
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
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

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
  onConfirm: (
    jitoTipSol: number,
    returnSolToMainWallet: boolean
  ) => Promise<void>;
  onCancel?: () => Promise<void>;
};

const EXIT_CHUNK_SIZE = 20;

const statusVariantMap: Record<
  string,
  "default" | "secondary" | "destructive" | "outline"
> = {
  PENDING: "secondary",
  RUNNING: "default",
  PARTIAL_SUCCESS: "secondary",
  SUCCEEDED: "outline",
  FAILED: "destructive",
};

const statusLabelMap: Record<string, string> = {
  PENDING: "Pending",
  RUNNING: "Running",
  PARTIAL_SUCCESS: "Partial Success",
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
  const [returnSolToMainWallet, setReturnSolToMainWallet] =
    React.useState(true);

  React.useEffect(() => {
    if (!open) {
      setTip("0.005");
      setReturnSolToMainWallet(true);
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
  const canClose =
    status === "SUCCEEDED" ||
    status === "PARTIAL_SUCCESS" ||
    status === "FAILED" ||
    status === "RUNNING";
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
        cleanupFailedWallets?: number;
        requestedReturnSolToMainWallet?: boolean;
        effectiveReturnSolToMainWallet?: boolean;
        systemDevImmediateSweeps?: number;
        systemDevImmediateSweepFailures?: number;
        systemDevImmediateSweepLamports?: number;
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
    typeof exitInput?.jitoTipSol === "number"
      ? exitInput.jitoTipSol
      : localTipSol;
  const activeReturnSolToMainWallet =
    typeof summary?.effectiveReturnSolToMainWallet === "boolean"
      ? summary.effectiveReturnSolToMainWallet
      : typeof exitInput?.returnSolToMainWallet === "boolean"
      ? exitInput.returnSolToMainWallet
      : returnSolToMainWallet;
  const estimatedBundles =
    walletsWithBalance > 0
      ? Math.ceil(walletsWithBalance / EXIT_CHUNK_SIZE)
      : 0;
  const estimatedTotalTipSol = activeTipSol * estimatedBundles;

  const showProgress = Boolean(exit);
  const showSummary =
    (status === "SUCCEEDED" || status === "PARTIAL_SUCCESS") && summary;
  const showError = status === "FAILED" && exit?.errorMessage;
  const showCleanupWarning =
    status === "PARTIAL_SUCCESS" &&
    (exit?.errorMessage || (summary?.cleanupFailedWallets ?? 0) > 0);
  const activityItems = React.useMemo(
    () =>
      [...(exit?.logs ?? [])]
        .sort(
          (left, right) =>
            new Date(right.createdAt).getTime() -
            new Date(left.createdAt).getTime()
        )
        .map((log, index) => ({
          ...log,
          isLatest: index === 0,
        })),
    [exit?.logs]
  );

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
                onCheckedChange={(value) =>
                  setReturnSolToMainWallet(Boolean(value))
                }
              />
              <div className="grid gap-1">
                <div className="flex items-center gap-1.5">
                  <Label htmlFor="exitReturnSolToMainWallet">
                    Return SOL to main wallet
                  </Label>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        className="text-muted-foreground transition-colors hover:text-foreground"
                        aria-label="About returning SOL to main wallet"
                      >
                        <Info className="size-3.5" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="top" className="max-w-sm">
                      After exit processing, spendable SOL from processed
                      wallets is sent back to your main wallet. System dev
                      wallet proceeds are always swept back to main.
                    </TooltipContent>
                  </Tooltip>
                </div>
              </div>
            </div>
            <div className="rounded-md border p-3 text-xs text-muted-foreground">
              <p>
                Exit sells tokens across managed wallets, closes empty token
                accounts, and{" "}
                {returnSolToMainWallet ? "returns" : "can return"} leftover SOL
                to your main wallet. Jito tip is paid per bundle. Estimated
                bundles:{" "}
                <span className="font-mono">{estimatedBundles}</span>, estimated
                total tip:{" "}
                <span className="font-mono">
                  {estimatedTotalTipSol.toFixed(4)} SOL
                </span>
                .
              </p>
            </div>
          </div>
        )}

        {showProgress && (
          <div className="space-y-4 min-w-0">
            <Progress value={progress} className="w-full" />
            <Separator />
            {showSummary && (
              <div
                className={`rounded-md border p-3 space-y-2 ${
                  status === "PARTIAL_SUCCESS"
                    ? "border-amber-500/30 bg-amber-500/5"
                    : "border-emerald-500/30 bg-emerald-500/5"
                }`}
              >
                <div
                  className={`text-sm font-medium ${
                    status === "PARTIAL_SUCCESS"
                      ? "text-amber-700 dark:text-amber-300"
                      : "text-emerald-700 dark:text-emerald-300"
                  }`}
                >
                  {status === "PARTIAL_SUCCESS"
                    ? "Exit completed with cleanup issues"
                    : "Exit succeeded"}
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
                        {(
                          (summary?.fundingLamports ?? 0) / 1_000_000_000
                        ).toFixed(4)}{" "}
                        SOL)
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
                  {(summary?.cleanupFailedWallets ?? 0) > 0 && (
                    <div className="flex items-center justify-between">
                      <span>Cleanup failures</span>
                      <span className="font-mono">
                        {summary?.cleanupFailedWallets}
                      </span>
                    </div>
                  )}
                  {(summary?.systemDevImmediateSweeps ?? 0) > 0 && (
                    <div className="flex items-center justify-between">
                      <span>System dev sweeps</span>
                      <span className="font-mono">
                        {summary?.systemDevImmediateSweeps} (
                        {(
                          (summary?.systemDevImmediateSweepLamports ?? 0) /
                          1_000_000_000
                        ).toFixed(4)}{" "}
                        SOL)
                      </span>
                    </div>
                  )}
                  {(summary?.systemDevImmediateSweepFailures ?? 0) > 0 && (
                    <div className="flex items-center justify-between">
                      <span>System dev sweep failures</span>
                      <span className="font-mono">
                        {summary?.systemDevImmediateSweepFailures}
                      </span>
                    </div>
                  )}
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
            {showCleanupWarning && (
              <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-sm text-amber-700 dark:text-amber-300">
                {exit?.errorMessage ??
                  "Some cleanup steps failed after the exit bundle succeeded."}
              </div>
            )}
            <div className="rounded-md border p-3 text-xs text-muted-foreground">
              Tip per bundle:{" "}
              <span className="font-mono">{activeTipSol.toFixed(4)} SOL</span>
              <br />
              SOL return to main wallet:{" "}
              <span className="font-mono">
                {activeReturnSolToMainWallet ? "Enabled" : "Disabled"}
              </span>
              {typeof summary?.requestedReturnSolToMainWallet === "boolean" &&
              typeof summary?.effectiveReturnSolToMainWallet === "boolean" &&
              summary.requestedReturnSolToMainWallet !==
                summary.effectiveReturnSolToMainWallet ? (
                <>
                  <br />
                  <span className="font-mono">
                    Forced on for system dev wallet handling
                  </span>
                </>
              ) : null}
            </div>
            <div className="space-y-2">
              <div className="text-sm font-medium">Activity</div>
              <div className="max-h-72 overflow-y-auto rounded-md border p-3 space-y-2">
                {activityItems.length ? (
                  activityItems.map((log) => (
                    <div
                      key={log.id}
                      className={`rounded-md border px-3 py-2 text-sm ${
                        log.isLatest
                          ? "border-primary/40 bg-primary/5 shadow-sm"
                          : log.level === "ERROR"
                            ? "border-destructive/30 bg-destructive/5"
                            : "border-border/70"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <div
                            className={`wrap-break-word ${
                              log.isLatest
                                ? "font-medium text-foreground"
                                : "text-foreground"
                            }`}
                          >
                            {log.message}
                          </div>
                          <div className="mt-1 flex flex-wrap items-center gap-2">
                            <Badge
                              variant={
                                log.level === "ERROR"
                                  ? "destructive"
                                  : "secondary"
                              }
                            >
                              {log.level}
                            </Badge>
                            {log.step ? (
                              <div className="text-xs text-muted-foreground wrap-break-word">
                                {log.step}
                              </div>
                            ) : null}
                          </div>
                        </div>
                        <div className="text-xs text-muted-foreground shrink-0">
                          {new Date(log.createdAt).toLocaleTimeString()}
                        </div>
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

        <DialogFooter className="sm:items-center">
          <div className="flex items-center gap-1.5 text-sm text-muted-foreground sm:mr-auto">
            <span>
              Powered by{" "}
              <a
                href="https://www.jito.wtf/"
                target="_blank"
                rel="noreferrer"
                className="underline underline-offset-4 transition-colors hover:text-foreground"
              >
                Jito
              </a>
            </span>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  className="inline-flex text-muted-foreground transition-colors hover:text-foreground"
                  aria-label="About Jito bundles"
                >
                  <Info className="size-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="top" className="max-w-sm">
                Exit submits the sell flow as Jito bundles so grouped
                instructions can land together with priority.
              </TooltipContent>
            </Tooltip>
          </div>
          {showProgress ? (
            <div className="flex w-full gap-2 justify-end sm:w-auto">
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
