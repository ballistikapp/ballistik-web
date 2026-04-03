"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
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
import {
  buildLaunchActivityItems,
  getLaunchFailureGuidance,
} from "./launch-progress-dialog.helpers";

type RouterOutputs = inferRouterOutputs<AppRouter>;
type LaunchStatusOutput = RouterOutputs["launch"]["status"];
type LaunchActiveOutput = RouterOutputs["launch"]["getActive"];

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
  onRetry?: () => void;
  retryPending?: boolean;
}

export function LaunchProgressDialog({
  open,
  onOpenChange,
  launch,
  onCancel,
  onClose,
  onRetry,
  retryPending = false,
}: LaunchProgressDialogProps) {
  const router = useRouter();
  const utils = trpc.useUtils();

  const status = launch?.status ?? "PENDING";
  const progress = launch?.progress ?? 0;
  const canCancel = status === "PENDING" || status === "RUNNING";
  const canClose =
    status === "SUCCEEDED" || status === "FAILED" || status === "CANCELED";
  const currentStep = launch?.currentStep || "Preparing";
  const showPatienceMessage = status === "PENDING" || status === "RUNNING";
  const tokenPublicKey = launch?.tokenPublicKey ?? "";
  const hasTokenPublicKey = Boolean(tokenPublicKey);
  const hasTokenLink = status === "SUCCEEDED" && hasTokenPublicKey;
  const failedTokensHref = "/tokens";
  const activityItems = buildLaunchActivityItems(launch?.logs ?? []);
  const failureGuidance = getLaunchFailureGuidance({
    status,
    result: launch?.result,
  });

  const handleGoToToken = React.useCallback(() => {
    if (!tokenPublicKey) return;
    void (async () => {
      await Promise.all([
        utils.dashboard.getStats.invalidate({ tokenPublicKey }),
        utils.dashboard.getDefiPools.invalidate({ tokenPublicKey }),
        utils.token.getByPublicKey.invalidate({ publicKey: tokenPublicKey }),
      ]);
      router.push(`/${tokenPublicKey}/dashboard`);
    })();
  }, [router, tokenPublicKey, utils]);

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
          {showPatienceMessage && (
            <div className="py-2 text-sm text-muted-foreground">
              Token creation may take couple of minutes.
            </div>
          )}
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
                  <Button size="sm" onClick={handleGoToToken}>
                    Go to token
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
              {activityItems.length ? (
                activityItems.map((log) => (
                  <div
                    key={log.id}
                    className={`rounded-md border px-3 py-2 text-sm ${
                      log.isLatest
                        ? "border-primary/40 bg-primary/5 shadow-sm"
                        : log.tone === "error"
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
                        {log.step && (
                          <div className="text-xs text-muted-foreground capitalize wrap-break-word">
                            {log.step}
                          </div>
                        )}
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
          {status === "FAILED" && failureGuidance.showManageTokensAction && (
            <div className="space-y-2">
              <div className="text-sm font-medium">Launch Failed</div>
              <div className="rounded-md border p-3 space-y-3">
                {launch?.errorMessage ? (
                  <div className="text-sm text-foreground wrap-break-word">
                    {launch.errorMessage}
                  </div>
                ) : null}
                {failureGuidance.description ? (
                  <div className="text-sm text-muted-foreground">
                    {failureGuidance.description}
                  </div>
                ) : null}
                <div className="flex items-center justify-end">
                  <Button asChild size="sm" variant="outline">
                    <Link href={failedTokensHref}>Go to My Tokens</Link>
                  </Button>
                </div>
              </div>
            </div>
          )}
          <div className="flex justify-end gap-3">
            {status === "FAILED" && onRetry && (
              <Button onClick={onRetry} disabled={retryPending}>
                {retryPending && <Spinner className="mr-2 size-4" />}
                Retry launch
              </Button>
            )}
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
