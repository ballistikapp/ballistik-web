"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  Activity,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  RefreshCw,
} from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

const MONITORING_PANEL_STATE_KEY = "dashboard:monitoring-panel:minimized";
type MonitoringHealthState = "off" | "healthy" | "degraded" | "failed";

interface MonitoringPanelProps {
  isMonitoring: boolean;
  disabledMessage?: string | null;
  disabledActionHref?: string;
  disabledActionLabel?: string;
  onToggleMonitoring: (enabled: boolean) => void | Promise<void>;
  onRefresh: () => void | Promise<void>;
  isRefreshing: boolean;
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
  healthState,
  dataUpdatedAt,
}: MonitoringPanelProps) {
  const [minimized, setMinimized] = useState(true);
  const [secondsAgo, setSecondsAgo] = useState(0);
  const [toggling, setToggling] = useState(false);
  const [hasLoadedMinimizedState, setHasLoadedMinimizedState] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const storedState = window.localStorage.getItem(MONITORING_PANEL_STATE_KEY);
    if (storedState === "open") {
      setMinimized(false);
    } else if (storedState === "closed") {
      setMinimized(true);
    }

    setHasLoadedMinimizedState(true);
  }, []);

  useEffect(() => {
    if (!hasLoadedMinimizedState || typeof window === "undefined") return;

    window.localStorage.setItem(
      MONITORING_PANEL_STATE_KEY,
      minimized ? "closed" : "open"
    );
  }, [hasLoadedMinimizedState, minimized]);

  useEffect(() => {
    if (intervalRef.current) clearInterval(intervalRef.current);

    const tick = () => {
      if (dataUpdatedAt > 0) {
        const elapsed = Math.floor((Date.now() - dataUpdatedAt) / 1000);
        setSecondsAgo((current) => (current === elapsed ? current : elapsed));
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
          : "Monitoring off";

  const controls = (
    <div className="flex items-center gap-2">
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={() => setMinimized((current) => !current)}
            className={cn(
              "flex items-center gap-2.5 rounded-full px-4 py-2 text-sm font-medium shadow-lg border transition-colors cursor-pointer",
              "bg-card text-card-foreground border-border hover:bg-muted"
            )}
          >
            <span
              className={cn(
                "size-2.5 rounded-full shrink-0",
                statusIndicatorClass
              )}
            />
            <span className="tabular-nums">{secondsAgo}s ago</span>
            {minimized ? (
              <ChevronUp className="size-3.5" />
            ) : (
              <ChevronDown className="size-3.5" />
            )}
          </button>
        </TooltipTrigger>
        <TooltipContent side="top">
          {minimized ? "Open monitoring panel" : "Close monitoring panel"}
        </TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="size-9 rounded-full bg-card! shadow-lg"
            onClick={handleRefresh}
            disabled={isRefreshing}
          >
            <RefreshCw
              className={cn("size-3.5", isRefreshing && "animate-spin")}
            />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="top">
          {isRefreshing ? "Refreshing..." : "Refresh dashboard"}
        </TooltipContent>
      </Tooltip>
    </div>
  );

  return (
    <div className="fixed bottom-5 right-5 z-50 flex flex-col items-end gap-2">
      {!minimized && (
        <div className="w-72 rounded-xl border bg-card text-card-foreground shadow-lg">
          <div className="flex items-center justify-between px-4 py-2.5 border-b">
            <div className="flex items-center gap-2.5">
              <Activity className="size-4 text-muted-foreground" />
              <span className="text-sm font-semibold">Monitoring</span>
            </div>
          </div>

          <div className="px-4 py-3 space-y-3.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <span
                  className={cn(
                    "size-2.5 rounded-full shrink-0",
                    statusIndicatorClass
                  )}
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
                <span>
                  SSE lost. Transactions fallback to polling; holdings
                  auto-refresh continues.
                </span>
              </div>
            )}

            {isMonitoring && healthState === "degraded" && (
              <div className="flex items-center gap-2 text-xs text-amber-500">
                <AlertTriangle className="size-3.5 shrink-0" />
                <span>
                  Live transactions are delayed; holdings keep auto-refreshing.
                </span>
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
          </div>
        </div>
      )}

      {controls}
    </div>
  );
}
