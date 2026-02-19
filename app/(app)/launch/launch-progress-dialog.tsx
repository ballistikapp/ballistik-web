"use client";

import * as React from "react";
import Link from "next/link";
import { toast } from "sonner";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@/server/trpc/routers/_app";
import { trpc } from "@/lib/trpc/client";
import { copyToClipboard } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";

type RouterOutputs = inferRouterOutputs<AppRouter>;
type LaunchStatusOutput = RouterOutputs["launch"]["status"];
type LaunchActiveOutput = RouterOutputs["launch"]["getActive"];
type LaunchRecoveryWallet =
  RouterOutputs["launch"]["recoveryWallets"]["wallets"][number];

const statusVariantMap: Record<
  string,
  "default" | "secondary" | "destructive" | "outline"
> = {
  PENDING: "secondary",
  RUNNING: "default",
  SUCCEEDED: "outline",
  FAILED: "destructive",
  CANCELED: "secondary",
};

const statusLabelMap: Record<string, string> = {
  PENDING: "Pending",
  RUNNING: "Running",
  SUCCEEDED: "Succeeded",
  FAILED: "Failed",
  CANCELED: "Canceled",
};

interface LaunchProgressDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  launch: LaunchStatusOutput | LaunchActiveOutput | null;
  onCancel: () => void;
  onClose: () => void;
}

export function LaunchProgressDialog({
  open,
  onOpenChange,
  launch,
  onCancel,
  onClose,
}: LaunchProgressDialogProps) {
  const utils = trpc.useUtils();
  const status = launch?.status ?? "PENDING";
  const progress = launch?.progress ?? 0;
  const canCancel = status === "PENDING" || status === "RUNNING";
  const canClose =
    status === "SUCCEEDED" || status === "FAILED" || status === "CANCELED";
  const currentStep = launch?.currentStep || "Preparing";
  const tokenPublicKey = launch?.tokenPublicKey ?? "";
  const hasTokenPublicKey = Boolean(tokenPublicKey);
  const hasTokenLink = status === "SUCCEEDED" && hasTokenPublicKey;
  const recoveryEnabled =
    Boolean(launch?.id) && (status === "FAILED" || status === "CANCELED");
  const recoveryQuery = trpc.launch.recoveryWallets.useQuery(
    { launchId: launch?.id ?? "" },
    { enabled: recoveryEnabled }
  );
  const recoverMutation = trpc.launch.recoverSol.useMutation();
  const refreshWalletBalancesMutation = trpc.wallet.refreshBalances.useMutation();
  const refreshMainWalletMutation = trpc.wallet.refreshMainBalance.useMutation();

  const recoveryWallets: LaunchRecoveryWallet[] =
    recoveryQuery.data?.wallets ?? [];
  const hasRecoverableBalance = recoveryWallets.some(
    (wallet) => Number(wallet.balanceSol ?? 0) > 0
  );

  const formatSol = (value: number | string | null | undefined) => {
    const numeric = Number(value ?? 0);
    if (!Number.isFinite(numeric)) {
      return "0.0000";
    }
    return numeric.toFixed(4);
  };

  const handleRecover = async () => {
    if (!launch?.id) return;
    const toastId = toast.loading("Returning SOL...", {
      icon: <Spinner className="size-4" />,
    });
    try {
      const result = await recoverMutation.mutateAsync({ launchId: launch.id });
      const returnedWalletPublicKeys = result.results
        .filter((item) => item.status === "returned")
        .map((item) => item.publicKey);
      const refreshWalletPublicKeys = Array.from(
        new Set([result.mainWalletPublicKey, ...returnedWalletPublicKeys])
      );
      if (tokenPublicKey) {
        await refreshWalletBalancesMutation.mutateAsync({
          tokenPublicKey,
          walletPublicKeys: refreshWalletPublicKeys,
          force: true,
        });
      } else {
        await refreshMainWalletMutation.mutateAsync({});
      }
      await Promise.all([
        utils.wallet.getMain.invalidate(),
        tokenPublicKey
          ? utils.wallet.getOperationalByToken.invalidate({ tokenPublicKey })
          : Promise.resolve(),
        tokenPublicKey
          ? utils.wallet.getDevByToken.invalidate({ tokenPublicKey })
          : Promise.resolve(),
      ]);
      const returnedCount = result.results.filter(
        (item) => item.status === "returned"
      ).length;
      const failedCount = result.results.filter(
        (item) => item.status === "failed"
      ).length;
      if (returnedCount === 0 && failedCount === 0) {
        toast.message("No SOL available to return", {
          id: toastId,
          icon: null,
        });
      } else if (failedCount > 0) {
        toast.error("Some returns failed", {
          id: toastId,
          description: `${returnedCount} succeeded, ${failedCount} failed.`,
          icon: null,
        });
      } else {
        toast.success("SOL returned to main wallet", {
          id: toastId,
          description: `${returnedCount} wallet${
            returnedCount === 1 ? "" : "s"
          }`,
          icon: null,
        });
      }
      await recoveryQuery.refetch();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Recovery failed";
      toast.error(message, { id: toastId, icon: null });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto overflow-x-hidden">
        <DialogHeader className="min-w-0">
          <DialogTitle className="flex items-center gap-3">
            Launch Progress
            <Badge variant={statusVariantMap[status] ?? "secondary"}>
              {statusLabelMap[status] ?? status}
            </Badge>
          </DialogTitle>
          <DialogDescription className="flex flex-wrap items-center justify-between gap-2">
            <span className="min-w-0 wrap-break-word">{currentStep}</span>
            <span className="shrink-0">{progress}%</span>
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 min-w-0">
          <Progress value={progress} className="w-full" />
          <Separator />
          {hasTokenPublicKey && (
            <div className="rounded-md border border-primary/30 bg-primary/5 p-3 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-sm font-medium">Token public key</div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    copyToClipboard(tokenPublicKey, "Token public key")
                  }
                >
                  Copy
                </Button>
              </div>
              <div className="font-mono text-sm break-all">
                {tokenPublicKey}
              </div>
              <div className="flex justify-end">
                {hasTokenLink ? (
                  <Button asChild size="sm">
                    <Link href={`/${tokenPublicKey}/dashboard`}>
                      Go to token
                    </Link>
                  </Button>
                ) : (
                  <Button size="sm" disabled>
                    Go to token
                  </Button>
                )}
              </div>
            </div>
          )}
          <div className="space-y-2">
            <div className="text-sm font-medium">Activity</div>
            <div className="max-h-72 overflow-y-auto rounded-md border p-3 space-y-2">
              {launch?.logs?.length ? (
                launch.logs.map((log) => (
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
          {recoveryEnabled && (
            <div className="space-y-2">
              <div className="text-sm font-medium">Recovery</div>
              <div className="rounded-md border p-3 space-y-3">
                {recoveryQuery.isLoading ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Spinner className="size-4" />
                    Loading recovery wallets...
                  </div>
                ) : recoveryQuery.error ? (
                  <div className="text-sm text-muted-foreground">
                    Recovery data is unavailable.
                  </div>
                ) : (
                  <>
                    <div className="text-xs text-muted-foreground break-all">
                      Returning funds to{" "}
                      {recoveryQuery.data?.mainWalletPublicKey}
                    </div>
                    {recoveryQuery.data?.source === "fallback" && (
                      <div className="text-xs text-muted-foreground">
                        Showing unassigned wallets because launch recovery data
                        was not saved.
                      </div>
                    )}
                    {recoveryQuery.data?.excludedDevWalletPublicKey && (
                      <div className="text-xs text-muted-foreground break-all">
                        Imported dev wallet not included:{" "}
                        {recoveryQuery.data.excludedDevWalletPublicKey}
                      </div>
                    )}
                    {recoveryWallets.length ? (
                      <div className="space-y-2">
                        {recoveryWallets.map((wallet) => (
                          <div
                            key={wallet.publicKey}
                            className="flex flex-wrap items-center justify-between gap-2 text-sm"
                          >
                            <div className="flex items-center gap-2 min-w-0">
                              <Badge variant="secondary">{wallet.type}</Badge>
                              <span className="font-mono text-xs break-all">
                                {wallet.publicKey}
                              </span>
                            </div>
                            <span className="text-xs text-muted-foreground">
                              {formatSol(wallet.balanceSol)} SOL
                            </span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="text-sm text-muted-foreground">
                        No recovery wallets available.
                      </div>
                    )}
                    <div className="flex flex-wrap justify-end gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => recoveryQuery.refetch()}
                        disabled={recoveryQuery.isFetching}
                      >
                        {recoveryQuery.isFetching && (
                          <Spinner className="mr-2 size-4" />
                        )}
                        Refresh
                      </Button>
                      <Button
                        size="sm"
                        onClick={handleRecover}
                        disabled={
                          recoverMutation.isPending ||
                          recoveryWallets.length === 0 ||
                          !hasRecoverableBalance
                        }
                      >
                        {recoverMutation.isPending
                          ? "Returning..."
                          : "Return SOL"}
                      </Button>
                    </div>
                  </>
                )}
              </div>
            </div>
          )}
          <div className="flex justify-end gap-3">
            {canCancel && (
              <Button variant="destructive" onClick={onCancel}>
                Cancel
              </Button>
            )}
            {canClose && (
              <Button variant="outline" onClick={onClose}>
                Close
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
