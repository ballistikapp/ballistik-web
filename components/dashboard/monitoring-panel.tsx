"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Activity, ChevronDown, ChevronUp, RefreshCw } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

const POLL_INTERVAL_SECONDS = 30;

interface MonitoringPanelProps {
  isMonitoring: boolean;
  onToggleMonitoring: (enabled: boolean) => void;
  onRefresh: () => void;
  isRefreshing: boolean;
  dataUpdatedAt: number;
}

export function MonitoringPanel({
  isMonitoring,
  onToggleMonitoring,
  onRefresh,
  isRefreshing,
  dataUpdatedAt,
}: MonitoringPanelProps) {
  const [minimized, setMinimized] = useState(false);
  const [secondsAgo, setSecondsAgo] = useState(0);
  const [countdown, setCountdown] = useState(POLL_INTERVAL_SECONDS);
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
                className={cn(
                  "size-2.5 rounded-full shrink-0",
                  isMonitoring
                    ? "bg-green-500 animate-pulse"
                    : "bg-muted-foreground/40"
                )}
              />
              <span className="tabular-nums">
                {secondsAgo}s ago
              </span>
              <ChevronUp className="size-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="left">
            {isMonitoring ? "Monitoring active" : "Monitoring off"}
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
                className={cn(
                  "size-2.5 rounded-full shrink-0",
                  isMonitoring
                    ? "bg-green-500 animate-pulse"
                    : "bg-muted-foreground/40"
                )}
              />
              <span className="text-sm">
                {isMonitoring ? "Real-time" : "Polling (30s)"}
              </span>
            </div>
            <Switch
              checked={isMonitoring}
              onCheckedChange={onToggleMonitoring}
            />
          </div>

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
        </div>
      </div>
    </div>
  );
}
