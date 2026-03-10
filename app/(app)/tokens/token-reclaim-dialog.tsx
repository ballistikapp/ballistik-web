"use client";

import * as React from "react";
import { toast } from "sonner";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@/server/trpc/routers/_app";
import { trpc } from "@/lib/trpc/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";

type RouterOutputs = inferRouterOutputs<AppRouter>;
type RecoveryWallet =
  RouterOutputs["launch"]["recoveryWallets"]["wallets"][number];

type TokenReclaimDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tokenPublicKey?: string | null;
  launchId?: string | null;
};

function formatSol(value: number | string | null | undefined) {
  const numeric = Number(value ?? 0);
  if (!Number.isFinite(numeric)) {
    return "0.0000";
  }
  return numeric.toFixed(4);
}

export function TokenReclaimDialog({
  open,
  onOpenChange,
  tokenPublicKey,
  launchId,
}: TokenReclaimDialogProps) {
  const utils = trpc.useUtils();
  const tokenReclaimTarget = tokenPublicKey ?? "";
  const launchReclaimTarget = launchId ?? "";
  const recoveryByTokenQuery = trpc.launch.recoveryWalletsByToken.useQuery(
    { tokenPublicKey: tokenReclaimTarget },
    {
      enabled: open && Boolean(tokenPublicKey),
    }
  );
  const recoveryByLaunchQuery = trpc.launch.recoveryWallets.useQuery(
    { launchId: launchReclaimTarget },
    {
      enabled: open && !tokenPublicKey && Boolean(launchId),
    }
  );
  const recoverMutation = trpc.launch.recoverSolByToken.useMutation();
  const recoverByLaunchMutation = trpc.launch.recoverSol.useMutation();
  const refreshWalletBalancesMutation = trpc.wallet.refreshBalances.useMutation();
  const refreshMainWalletMutation = trpc.wallet.refreshMainBalance.useMutation();
  const recoveryQuery = tokenPublicKey ? recoveryByTokenQuery : recoveryByLaunchQuery;

  const wallets: RecoveryWallet[] = recoveryQuery.data?.wallets ?? [];
  const hasRecoverableBalance = wallets.some(
    (wallet) => Number(wallet.balanceSol ?? 0) > 0
  );

  const handleRecover = async () => {
    if (!tokenPublicKey && !launchId) {
      return;
    }
    const toastId = toast.loading("Returning SOL...", {
      icon: <Spinner className="size-4" />,
    });
    try {
      const result = tokenPublicKey
        ? await recoverMutation.mutateAsync({ tokenPublicKey })
        : await recoverByLaunchMutation.mutateAsync({ launchId: launchId! });
      const returnedWalletPublicKeys = result.results
        .filter((item) => item.status === "returned")
        .map((item) => item.publicKey);
      const refreshWalletPublicKeys = Array.from(
        new Set([result.mainWalletPublicKey, ...returnedWalletPublicKeys])
      );
      if (tokenPublicKey && refreshWalletPublicKeys.length > 0) {
        await refreshWalletBalancesMutation.mutateAsync({
          tokenPublicKey,
          walletPublicKeys: refreshWalletPublicKeys,
          force: true,
        });
      } else {
        await refreshMainWalletMutation.mutateAsync({});
      }
      await Promise.all([
        recoveryQuery.refetch(),
        utils.token.getAllUserTokens.invalidate(),
        utils.launch.getFailedLaunches.invalidate(),
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
        toast.message("No SOL available to return", { id: toastId, icon: null });
      } else if (failedCount > 0) {
        toast.error("Some returns failed", {
          id: toastId,
          description: `${returnedCount} succeeded, ${failedCount} failed.`,
          icon: null,
        });
      } else {
        toast.success("SOL returned to main wallet", {
          id: toastId,
          description: `${returnedCount} wallet${returnedCount === 1 ? "" : "s"}`,
          icon: null,
        });
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Recovery failed";
      toast.error(message, { id: toastId, icon: null });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Reclaim SOL</DialogTitle>
          <DialogDescription className="break-all">
            {tokenPublicKey
              ? `Token: ${tokenPublicKey}`
              : `Launch: ${launchId ?? "—"}`}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {recoveryQuery.isLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Spinner className="size-4" />
              Loading recovery wallets...
            </div>
          ) : recoveryQuery.error ? (
            <div className="text-sm text-muted-foreground">
              Recovery data is unavailable.
            </div>
          ) : wallets.length === 0 ? (
            <div className="text-sm text-muted-foreground">
              No recovery wallets available.
            </div>
          ) : (
            <div className="space-y-2">
              {wallets.map((wallet) => (
                <div
                  key={wallet.publicKey}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-2 text-sm"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <Badge variant="secondary">{wallet.type}</Badge>
                    <span className="font-mono text-xs break-all">
                      {wallet.publicKey}
                    </span>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {formatSol(wallet.balanceSol)} SOL
                  </div>
                </div>
              ))}
            </div>
          )}
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => recoveryQuery.refetch()}
              disabled={recoveryQuery.isFetching}
            >
              {recoveryQuery.isFetching && <Spinner className="mr-2 size-4" />}
              Refresh
            </Button>
            <Button
              onClick={handleRecover}
              disabled={
                recoverMutation.isPending ||
                recoverByLaunchMutation.isPending ||
                wallets.length === 0 ||
                !hasRecoverableBalance
              }
            >
              {recoverMutation.isPending || recoverByLaunchMutation.isPending
                ? "Returning..."
                : "Return SOL"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
