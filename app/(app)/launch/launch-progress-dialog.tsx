"use client";

import * as React from "react";
import Link from "next/link";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@/server/trpc/routers/_app";
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
  const status = launch?.status ?? "PENDING";
  const progress = launch?.progress ?? 0;
  const canCancel = status === "PENDING" || status === "RUNNING";
  const canClose =
    status === "SUCCEEDED" || status === "FAILED" || status === "CANCELED";
  const currentStep = launch?.currentStep || "Preparing";
  const tokenPublicKey = launch?.tokenPublicKey ?? "";
  const hasTokenPublicKey = Boolean(tokenPublicKey);
  const hasTokenLink = status === "SUCCEEDED" && hasTokenPublicKey;
  const failedTokensHref = "/tokens";

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
          {status === "FAILED" && (
            <div className="space-y-2">
              <div className="text-sm font-medium">Launch Failed</div>
              <div className="rounded-md border p-3 flex flex-wrap items-center justify-between gap-3">
                <div className="text-sm text-muted-foreground">
                  Manage reclaim from the Manage Tokens page.
                </div>
                <Button asChild size="sm" variant="outline">
                  <Link href={failedTokensHref}>Go to Manage Tokens</Link>
                </Button>
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
