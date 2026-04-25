"use client";

import * as React from "react";
import { Activity, Loader2, LogOut, Rocket } from "lucide-react";
import { toast } from "sonner";
import { LaunchProgressDialog } from "@/app/(app)/launch/launch-progress-dialog";
import { HoldingExitDialog } from "@/components/holdings/holding-exit-dialog";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc/client";
import { cn } from "@/lib/utils";

const ACTIVE_PROCESS_REFETCH_MS = 2000;

type ActiveProcessKind = "launch" | "exit";

interface HeaderProcess {
  id: string;
  kind: ActiveProcessKind;
  status: string;
  progress: number;
  label: string;
  currentStep: string | null;
  tokenPublicKey: string | null;
  tokenSymbol?: string | null;
}

export function ActiveProcessesHeader() {
  const utils = trpc.useUtils();
  const [selectedLaunchId, setSelectedLaunchId] = React.useState<string | null>(
    null
  );
  const [launchDialogOpen, setLaunchDialogOpen] = React.useState(false);
  const [selectedExit, setSelectedExit] = React.useState<HeaderProcess | null>(
    null
  );
  const [exitDialogOpen, setExitDialogOpen] = React.useState(false);

  const activeProcessesQuery = trpc.activeProcess.list.useQuery(undefined, {
    refetchInterval: (query) => {
      const processes = query.state.data ?? [];
      return processes.length > 0 ? ACTIVE_PROCESS_REFETCH_MS : false;
    },
  });

  const activeProcesses = activeProcessesQuery.data ?? [];

  const launchStatusQuery = trpc.launch.status.useQuery(
    { launchId: selectedLaunchId ?? "" },
    {
      enabled: launchDialogOpen && Boolean(selectedLaunchId),
      refetchInterval: (query) => {
        const launch = query.state.data;
        if (!launch) return ACTIVE_PROCESS_REFETCH_MS;
        return launch.status === "PENDING" || launch.status === "RUNNING"
          ? ACTIVE_PROCESS_REFETCH_MS
          : false;
      },
    }
  );

  const exitStatusQuery = trpc.holding.exitStatus.useQuery(
    { exitId: selectedExit?.id ?? "" },
    {
      enabled: exitDialogOpen && Boolean(selectedExit?.id),
      refetchInterval: (query) => {
        const exit = query.state.data;
        if (!exit) return ACTIVE_PROCESS_REFETCH_MS;
        return exit.status === "PENDING" || exit.status === "RUNNING"
          ? ACTIVE_PROCESS_REFETCH_MS
          : false;
      },
    }
  );

  const cancelLaunchMutation = trpc.launch.cancel.useMutation({
    onSuccess: () => {
      toast.message("Cancel requested", {
        description: "The launch will stop as soon as it is safe.",
      });
      void utils.activeProcess.list.invalidate();
      if (selectedLaunchId) {
        void utils.launch.status.invalidate({ launchId: selectedLaunchId });
      }
    },
    onError: (error) => {
      toast.error("Failed to cancel launch", {
        description: error.message || "Unable to cancel the launch.",
      });
    },
  });

  const cancelExitMutation = trpc.holding.cancelExit.useMutation({
    onSuccess: () => {
      toast.message("Cancel requested", {
        description: "The exit will stop as soon as it is safe.",
      });
      void utils.activeProcess.list.invalidate();
      if (selectedExit) {
        void utils.holding.exitStatus.invalidate({ exitId: selectedExit.id });
      }
    },
    onError: (error) => {
      toast.error("Failed to cancel exit", {
        description: error.message || "Unable to cancel the exit.",
      });
    },
  });

  React.useEffect(() => {
    const launch = launchStatusQuery.data;
    if (
      launch &&
      launch.status !== "PENDING" &&
      launch.status !== "RUNNING"
    ) {
      void utils.activeProcess.list.invalidate();
    }
  }, [launchStatusQuery.data, utils]);

  React.useEffect(() => {
    const exit = exitStatusQuery.data;
    if (exit && exit.status !== "PENDING" && exit.status !== "RUNNING") {
      void utils.activeProcess.list.invalidate();
    }
  }, [exitStatusQuery.data, utils]);

  const handleProcessClick = (process: HeaderProcess) => {
    if (process.kind === "launch") {
      setSelectedLaunchId(process.id);
      setLaunchDialogOpen(true);
      return;
    }

    if (process.kind === "exit") {
      setSelectedExit(process);
      setExitDialogOpen(true);
    }
  };

  const handleLaunchDialogOpenChange = (open: boolean) => {
    setLaunchDialogOpen(open);
    if (!open) {
      void utils.activeProcess.list.invalidate();
    }
  };

  const handleCloseLaunchDialog = () => {
    setLaunchDialogOpen(false);
    void utils.activeProcess.list.invalidate();
  };

  const handleExitDialogOpenChange = (open: boolean) => {
    setExitDialogOpen(open);
    if (!open) {
      void utils.activeProcess.list.invalidate();
    }
  };

  const handleCloseExitDialog = () => {
    setExitDialogOpen(false);
    void utils.activeProcess.list.invalidate();
  };

  return (
    <>
      {activeProcesses.length > 0 ? (
        <div className="flex min-w-0 items-center gap-1.5 overflow-hidden">
          {activeProcesses.map((process) => (
            <ActiveProcessPill
              key={`${process.kind}-${process.id}`}
              process={process}
              onClick={() => handleProcessClick(process)}
            />
          ))}
        </div>
      ) : (
        <EmptyProcessPill isLoading={activeProcessesQuery.isLoading} />
      )}
      <LaunchProgressDialog
        open={launchDialogOpen}
        onOpenChange={handleLaunchDialogOpenChange}
        launch={launchStatusQuery.data ?? null}
        onCancel={() => {
          if (!selectedLaunchId) return;
          cancelLaunchMutation.mutate({ launchId: selectedLaunchId });
        }}
        onClose={handleCloseLaunchDialog}
      />
      <HoldingExitDialog
        open={exitDialogOpen}
        onOpenChange={handleExitDialogOpenChange}
        exit={exitStatusQuery.data ?? null}
        tokenSymbol={selectedExit?.tokenSymbol ?? "TOKEN"}
        totalWallets={0}
        walletsWithBalance={0}
        totalBalance={0}
        isCancelling={cancelExitMutation.isPending}
        onConfirm={async () => {
          toast.message("Exit already in progress", {
            description: "Use the progress view to monitor or cancel this exit.",
          });
        }}
        onCancel={async () => {
          if (!selectedExit) return;
          await cancelExitMutation.mutateAsync({ exitId: selectedExit.id });
        }}
      />
    </>
  );
}

function EmptyProcessPill({ isLoading }: { isLoading: boolean }) {
  return (
    <div
      className="flex h-8 max-w-[220px] min-w-0 items-center gap-2 rounded-full border border-border/70 bg-muted/30 px-3 text-xs text-muted-foreground"
      title={isLoading ? "Checking active processes" : "No active processes"}
    >
      {isLoading ? (
        <Loader2 className="size-3.5 shrink-0 animate-spin" />
      ) : (
        <Activity className="size-3.5 shrink-0" />
      )}
      <span className="hidden min-w-0 truncate sm:inline">
        {isLoading ? "Checking processes" : "No active processes"}
      </span>
      <span className="shrink-0 sm:hidden">Idle</span>
    </div>
  );
}

function ActiveProcessPill({
  process,
  onClick,
}: {
  process: HeaderProcess;
  onClick: () => void;
}) {
  const progress = Math.max(0, Math.min(100, process.progress));
  const isRunning = process.status === "PENDING" || process.status === "RUNNING";

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={onClick}
      className="h-8 max-w-[260px] min-w-0 gap-2 rounded-full border-primary/30 bg-primary/5 px-3 text-xs hover:bg-primary/10"
      title={`${process.label}: ${process.currentStep ?? process.status} (${progress}%)`}
    >
      {isRunning ? (
        <Loader2 className="size-3.5 shrink-0 animate-spin text-primary" />
      ) : process.kind === "exit" ? (
        <LogOut className="size-3.5 shrink-0 text-primary" />
      ) : (
        <Rocket className="size-3.5 shrink-0 text-primary" />
      )}
      <span className="shrink-0 font-medium">{process.label}</span>
      <span className="shrink-0 tabular-nums text-muted-foreground">
        {progress}%
      </span>
      {process.currentStep ? (
        <span
          className={cn(
            "hidden min-w-0 truncate text-muted-foreground sm:inline",
            "max-w-[120px] lg:max-w-[160px]"
          )}
        >
          {process.currentStep}
        </span>
      ) : null}
    </Button>
  );
}
