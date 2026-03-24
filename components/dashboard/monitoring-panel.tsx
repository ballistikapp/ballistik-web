"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Activity, AlertTriangle, ChevronDown, ChevronUp, RefreshCw } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

const POLL_INTERVAL_SECONDS = 30;
type MonitoringHealthState = "off" | "healthy" | "degraded" | "failed";

interface MonitoringPanelProps {
  isMonitoring: boolean;
  disabledMessage?: string | null;
  disabledActionHref?: string;
  disabledActionLabel?: string;
  onToggleMonitoring: (enabled: boolean) => void | Promise<void>;
  onRefresh: () => void | Promise<void>;
  isRefreshing: boolean;
  isFullRefresh: boolean;
  healthState: MonitoringHealthState;
  dataUpdatedAt: number;
}

export function MonitoringPanel({
  isMonitoring,
  disabledMessage,
  disabledActionHref,
  disabledActionLabel,
  onToggleMonitoring,
  onRefresh,
  isRefreshing,
  isFullRefresh,
  healthState,
  dataUpdatedAt,
}: MonitoringPanelProps) {
  const [minimized, setMinimized] = useState(false);
  const [secondsAgo, setSecondsAgo] = useState(0);
  const [countdown, setCountdown] = useState(POLL_INTERVAL_SECONDS);
  const [toggling, setToggling] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (intervalRef.current) clearInterval(intervalRef.current);

    const tick = () => {
      if (dataUpdatedAt > 0) {
        const elapsed = Math.floor((Date.now() - dataUpdatedAt) / 1000);
        setSecondsAgo(elapsed);
        setCountdown(Math.max(POLL_INTERVAL_SECONDS - elapsed, 0));
      }
    };

    tick();
    intervalRef.current = setInterval(tick, 1000);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [dataUpdatedAt]);

  const handleRefresh = useCallback(() => {
    if (!isRefreshing) {
      onRefresh();
    }
  }, [isRefreshing, onRefresh]);

  const statusIndicatorClass =
    healthState === "healthy"
      ? "bg-green-500 animate-pulse"
      : healthState === "degraded" || healthState === "failed"
        ? "bg-amber-500 animate-pulse"
        : "bg-muted-foreground/40";

  const statusText =
    healthState === "healthy"
      ? "Hybrid live"
      : healthState === "degraded"
        ? "Hybrid delayed"
        : healthState === "failed"
          ? "Disconnected"
          : "Polling (30s)";

  if (minimized) {
    return (
      <div className="fixed bottom-5 right-5 z-50">
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={() => setMinimized(false)}
              className={cn(
                "flex items-center gap-2.5 rounded-full px-4 py-2 text-sm font-medium shadow-lg border transition-colors cursor-pointer",
                "bg-card text-card-foreground border-border hover:bg-muted",
              )}
            >
              <span
                className={cn("size-2.5 rounded-full shrink-0", statusIndicatorClass)}
              />
              <span className="tabular-nums">
                {secondsAgo}s ago
              </span>
              <ChevronUp className="size-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="left">
            {isMonitoring
              ? healthState === "degraded"
                ? "Monitoring degraded"
                : healthState === "failed"
                  ? "Monitoring disconnected"
                  : "Monitoring active (hybrid)"
              : "Monitoring off"}
          </TooltipContent>
        </Tooltip>
      </div>
    );
  }

  return (
    <div className="fixed bottom-5 right-5 z-50 w-72">
      <div className="rounded-xl border bg-card text-card-foreground shadow-lg">
        <div className="flex items-center justify-between px-4 py-2.5 border-b">
          <div className="flex items-center gap-2.5">
            <Activity className="size-4 text-muted-foreground" />
            <span className="text-sm font-semibold">Monitoring</span>
          </div>
          <button
            type="button"
            onClick={() => setMinimized(true)}
            className="text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
          >
            <ChevronDown className="size-4" />
          </button>
        </div>

        <div className="px-4 py-3 space-y-3.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <span
                className={cn("size-2.5 rounded-full shrink-0", statusIndicatorClass)}
              />
              <span className="text-sm">{statusText}</span>
            </div>
            <Switch
              checked={isMonitoring}
              disabled={toggling}
              onCheckedChange={async (val) => {
                setToggling(true);
                try {
                  await onToggleMonitoring(val);
                } finally {
                  setToggling(false);
                }
              }}
            />
          </div>

          {isMonitoring && healthState === "failed" && (
            <div className="flex items-center gap-2 text-xs text-amber-500">
              <AlertTriangle className="size-3.5 shrink-0" />
              <span>SSE lost. Transactions fallback to polling; holdings auto-refresh continues.</span>
            </div>
          )}

          {isMonitoring && healthState === "degraded" && (
            <div className="flex items-center gap-2 text-xs text-amber-500">
              <AlertTriangle className="size-3.5 shrink-0" />
              <span>Live transactions are delayed; holdings keep auto-refreshing.</span>
            </div>
          )}

          {isMonitoring && healthState === "healthy" && (
            <div className="text-xs text-muted-foreground">
              Live transactions + auto-refreshing holdings
            </div>
          )}

          {!isMonitoring && disabledMessage && (
            <div className="space-y-2">
              <div className="flex items-start gap-2 text-xs text-muted-foreground">
                <AlertTriangle className="size-3.5 shrink-0 mt-0.5" />
                <span>{disabledMessage}</span>
              </div>
              {disabledActionHref && disabledActionLabel ? (
                <Button variant="outline" size="sm" asChild className="w-full">
                  <Link href={disabledActionHref}>{disabledActionLabel}</Link>
                </Button>
              ) : null}
            </div>
          )}

          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <span>
              Updated{" "}
              <span className="tabular-nums font-medium text-foreground">
                {secondsAgo}s
              </span>{" "}
              ago
            </span>
            {!isMonitoring && (
              <span>
                Next in{" "}
                <span className="tabular-nums font-medium text-foreground">
                  {countdown}s
                </span>
              </span>
            )}
          </div>

          {isFullRefresh ? (
            <Button
              variant="outline"
              size="sm"
              className="w-full h-8 text-sm"
              onClick={handleRefresh}
              disabled={isRefreshing}
            >
              <RefreshCw
                className={cn(
                  "size-3.5 mr-1.5",
                  isRefreshing && "animate-spin"
                )}
              />
              {isRefreshing ? "Refreshing..." : "Refresh now"}
            </Button>
          ) : (
            <button
              type="button"
              className="w-full text-center text-xs text-muted-foreground hover:text-foreground transition-colors cursor-pointer py-1"
              onClick={handleRefresh}
              disabled={isRefreshing}
            >
              {isRefreshing ? "Refreshing..." : "Re-read dashboard"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
