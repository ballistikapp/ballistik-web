"use client";

import * as React from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import type { AppRouter } from "@/server/trpc/routers/_app";
import type { inferRouterOutputs } from "@trpc/server";

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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3">
            Launch Progress
            <Badge variant={statusVariantMap[status] ?? "secondary"}>
              {statusLabelMap[status] ?? status}
            </Badge>
          </DialogTitle>
          <DialogDescription className="flex items-center justify-between">
            <span>{currentStep}</span>
            <span>{progress}%</span>
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <Progress value={progress} />
          <Separator />
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
                    <div className="flex-1">
                      <div className="text-foreground">{log.message}</div>
                      {log.step && (
                        <div className="text-xs text-muted-foreground">
                          {log.step}
                        </div>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground">
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
