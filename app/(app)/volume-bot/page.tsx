"use client";

import { useMemo, useState } from "react";
import { useQueryState } from "nuqs";
import { toast } from "sonner";
import { tokenQueryParser } from "@/lib/utils/token-query";
import { trpc } from "@/lib/trpc/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";

const presets = {
  conservative: {
    walletCount: 10,
    fundingPerWalletSol: 0.5,
    minTradeAmountSol: 0.01,
    maxTradeAmountSol: 0.03,
    minIntervalSeconds: 180,
    maxIntervalSeconds: 600,
    sellRatio: 0.9,
    strategy: "neutral" as const,
    maxLossPerWalletSol: 0.1,
    maxTotalLossSol: 1,
    slippageBps: 500,
    targetDurationHours: 24,
    sellOnStop: true,
  },
  aggressive: {
    walletCount: 30,
    fundingPerWalletSol: 1,
    minTradeAmountSol: 0.05,
    maxTradeAmountSol: 0.15,
    minIntervalSeconds: 30,
    maxIntervalSeconds: 180,
    sellRatio: 0.7,
    strategy: "pump" as const,
    maxLossPerWalletSol: 0.5,
    maxTotalLossSol: 5,
    slippageBps: 1000,
    targetDurationHours: 24,
    sellOnStop: true,
  },
};

export default function VolumeBotPage() {
  const [tokenPublicKey, setTokenPublicKey] = useQueryState(
    "token",
    tokenQueryParser
  );
  const [selectedPreset, setSelectedPreset] =
    useState<keyof typeof presets>("conservative");

  const [walletCount, setWalletCount] = useState(
    presets.conservative.walletCount
  );
  const [fundingPerWalletSol, setFundingPerWalletSol] = useState(
    presets.conservative.fundingPerWalletSol
  );
  const [minTradeAmountSol, setMinTradeAmountSol] = useState(
    presets.conservative.minTradeAmountSol
  );
  const [maxTradeAmountSol, setMaxTradeAmountSol] = useState(
    presets.conservative.maxTradeAmountSol
  );
  const [minIntervalSeconds, setMinIntervalSeconds] = useState(
    presets.conservative.minIntervalSeconds
  );
  const [maxIntervalSeconds, setMaxIntervalSeconds] = useState(
    presets.conservative.maxIntervalSeconds
  );
  const [sellRatio, setSellRatio] = useState(presets.conservative.sellRatio);
  const [strategy, setStrategy] = useState<"neutral" | "pump" | "dump">(
    presets.conservative.strategy
  );
  const [maxLossPerWalletSol, setMaxLossPerWalletSol] = useState(
    presets.conservative.maxLossPerWalletSol
  );
  const [maxTotalLossSol, setMaxTotalLossSol] = useState(
    presets.conservative.maxTotalLossSol
  );
  const [slippageBps, setSlippageBps] = useState(
    presets.conservative.slippageBps
  );
  const [targetDurationHours, setTargetDurationHours] = useState(
    presets.conservative.targetDurationHours
  );
  const [sellOnStop, setSellOnStop] = useState(presets.conservative.sellOnStop);

  const { data: tokens } = trpc.token.getUserTokens.useQuery();

  const {
    data: statusData,
    error: statusError,
    refetch: refetchStatus,
  } = trpc.volumeBot.status.useQuery(
    { tokenPublicKey: tokenPublicKey || undefined },
    { enabled: Boolean(tokenPublicKey), refetchInterval: 5000, retry: false }
  );

  const startMutation = trpc.volumeBot.start.useMutation({
    onSuccess: () => {
      toast.success("Volume bot started");
      refetchStatus();
    },
    onError: (error) => {
      toast.error(error.message || "Failed to start volume bot");
    },
  });

  const stopMutation = trpc.volumeBot.stop.useMutation({
    onSuccess: () => {
      toast.success("Stop requested");
      refetchStatus();
    },
    onError: (error) => {
      toast.error(error.message || "Failed to stop volume bot");
    },
  });

  const reclaimMutation = trpc.volumeBot.reclaim.useMutation({
    onSuccess: () => {
      toast.success("Reclaim requested");
    },
    onError: (error) => {
      toast.error(error.message || "Failed to reclaim funds");
    },
  });

  const closeAccountsMutation = trpc.volumeBot.closeAccounts.useMutation({
    onSuccess: () => {
      toast.success("Close accounts requested");
    },
    onError: (error) => {
      toast.error(error.message || "Failed to close accounts");
    },
  });

  const session = statusData?.session;
  const wallets = statusData?.wallets ?? [];
  const isRunning =
    session?.status === "RUNNING" ||
    session?.status === "STOP_REQUESTED" ||
    session?.status === "STOPPING";

  const totalFunding = useMemo(
    () => walletCount * fundingPerWalletSol,
    [walletCount, fundingPerWalletSol]
  );

  const handlePresetChange = (preset: keyof typeof presets) => {
    const nextPreset = presets[preset];
    setSelectedPreset(preset);
    setWalletCount(nextPreset.walletCount);
    setFundingPerWalletSol(nextPreset.fundingPerWalletSol);
    setMinTradeAmountSol(nextPreset.minTradeAmountSol);
    setMaxTradeAmountSol(nextPreset.maxTradeAmountSol);
    setMinIntervalSeconds(nextPreset.minIntervalSeconds);
    setMaxIntervalSeconds(nextPreset.maxIntervalSeconds);
    setSellRatio(nextPreset.sellRatio);
    setStrategy(nextPreset.strategy);
    setMaxLossPerWalletSol(nextPreset.maxLossPerWalletSol);
    setMaxTotalLossSol(nextPreset.maxTotalLossSol);
    setSlippageBps(nextPreset.slippageBps);
    setTargetDurationHours(nextPreset.targetDurationHours);
    setSellOnStop(nextPreset.sellOnStop);
  };

  const handleStart = async () => {
    if (!tokenPublicKey) {
      toast.error("Select a token first");
      return;
    }
    await startMutation.mutateAsync({
      tokenPublicKey,
      config: {
        walletCount,
        fundingPerWalletSol,
        minTradeAmountSol,
        maxTradeAmountSol,
        minIntervalSeconds,
        maxIntervalSeconds,
        sellRatio,
        strategy,
        maxLossPerWalletSol,
        maxTotalLossSol,
        slippageBps,
        targetDurationHours,
        sellOnStop,
      },
    });
  };

  const handleStop = async () => {
    if (!session) {
      return;
    }
    await stopMutation.mutateAsync({ sessionId: session.id });
  };

  const handleReclaim = async () => {
    if (!session) {
      return;
    }
    await reclaimMutation.mutateAsync({ sessionId: session.id });
  };

  const handleCloseAccounts = async () => {
    if (!session) {
      return;
    }
    await closeAccountsMutation.mutateAsync({ sessionId: session.id });
  };

  return (
    <div className="grid gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Volume Bot</h1>
          <p className="text-sm text-muted-foreground">
            Schedule and monitor automated volume trades.
          </p>
        </div>
        <Badge variant={isRunning ? "default" : "secondary"}>
          {isRunning ? "Running" : "Stopped"}
        </Badge>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Token</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Select
            value={tokenPublicKey ?? ""}
            onValueChange={setTokenPublicKey}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Select a token" />
            </SelectTrigger>
            <SelectContent>
              {tokens?.map((token) => (
                <SelectItem key={token.publicKey} value={token.publicKey}>
                  {token.name} ({token.symbol})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {statusError && statusError.data?.httpStatus !== 404 && (
            <p className="text-sm text-destructive">
              {statusError.message || "Failed to load status"}
            </p>
          )}
        </CardContent>
      </Card>

      {!isRunning && (
        <Card>
          <CardHeader>
            <CardTitle>Configuration</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-2">
              <Label>Preset</Label>
              <Select
                value={selectedPreset}
                onValueChange={(value) =>
                  handlePresetChange(value as keyof typeof presets)
                }
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select preset" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="conservative">Conservative</SelectItem>
                  <SelectItem value="aggressive">Aggressive</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label>Wallet count</Label>
                <Input
                  type="number"
                  min={1}
                  value={walletCount}
                  onChange={(event) =>
                    setWalletCount(Number(event.target.value))
                  }
                />
              </div>
              <div className="space-y-2">
                <Label>Funding per wallet (SOL)</Label>
                <Input
                  type="number"
                  min={0}
                  step={0.01}
                  value={fundingPerWalletSol}
                  onChange={(event) =>
                    setFundingPerWalletSol(Number(event.target.value))
                  }
                />
              </div>
              <div className="space-y-2">
                <Label>Min trade (SOL)</Label>
                <Input
                  type="number"
                  min={0}
                  step={0.001}
                  value={minTradeAmountSol}
                  onChange={(event) =>
                    setMinTradeAmountSol(Number(event.target.value))
                  }
                />
              </div>
              <div className="space-y-2">
                <Label>Max trade (SOL)</Label>
                <Input
                  type="number"
                  min={0}
                  step={0.001}
                  value={maxTradeAmountSol}
                  onChange={(event) =>
                    setMaxTradeAmountSol(Number(event.target.value))
                  }
                />
              </div>
              <div className="space-y-2">
                <Label>Min interval (sec)</Label>
                <Input
                  type="number"
                  min={1}
                  value={minIntervalSeconds}
                  onChange={(event) =>
                    setMinIntervalSeconds(Number(event.target.value))
                  }
                />
              </div>
              <div className="space-y-2">
                <Label>Max interval (sec)</Label>
                <Input
                  type="number"
                  min={1}
                  value={maxIntervalSeconds}
                  onChange={(event) =>
                    setMaxIntervalSeconds(Number(event.target.value))
                  }
                />
              </div>
              <div className="space-y-2">
                <Label>Sell ratio</Label>
                <Input
                  type="number"
                  min={0}
                  max={1}
                  step={0.1}
                  value={sellRatio}
                  onChange={(event) =>
                    setSellRatio(Number(event.target.value))
                  }
                />
              </div>
              <div className="space-y-2">
                <Label>Strategy</Label>
                <Select
                  value={strategy}
                  onValueChange={(value) =>
                    setStrategy(value as "neutral" | "pump" | "dump")
                  }
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select strategy" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="neutral">Neutral</SelectItem>
                    <SelectItem value="pump">Pump</SelectItem>
                    <SelectItem value="dump">Dump</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Max loss per wallet (SOL)</Label>
                <Input
                  type="number"
                  min={0}
                  step={0.01}
                  value={maxLossPerWalletSol}
                  onChange={(event) =>
                    setMaxLossPerWalletSol(Number(event.target.value))
                  }
                />
              </div>
              <div className="space-y-2">
                <Label>Max total loss (SOL)</Label>
                <Input
                  type="number"
                  min={0}
                  step={0.01}
                  value={maxTotalLossSol}
                  onChange={(event) =>
                    setMaxTotalLossSol(Number(event.target.value))
                  }
                />
              </div>
              <div className="space-y-2">
                <Label>Slippage (bps)</Label>
                <Input
                  type="number"
                  min={0}
                  value={slippageBps}
                  onChange={(event) =>
                    setSlippageBps(Number(event.target.value))
                  }
                />
              </div>
              <div className="space-y-2">
                <Label>Target duration (hours)</Label>
                <Input
                  type="number"
                  min={0}
                  value={targetDurationHours}
                  onChange={(event) =>
                    setTargetDurationHours(Number(event.target.value))
                  }
                />
              </div>
              <div className="space-y-2">
                <Label>Sell on stop</Label>
                <Select
                  value={sellOnStop ? "yes" : "no"}
                  onValueChange={(value) => setSellOnStop(value === "yes")}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="yes">Yes</SelectItem>
                    <SelectItem value="no">No</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="flex items-center justify-between">
              <div className="text-sm text-muted-foreground">
                Total funding: {totalFunding.toFixed(2)} SOL
              </div>
              <Button
                onClick={handleStart}
                disabled={startMutation.isPending || !tokenPublicKey}
              >
                {startMutation.isPending ? "Starting..." : "Start bot"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {session && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Status</CardTitle>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handleReclaim}
                disabled={reclaimMutation.isPending}
              >
                Reclaim
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleCloseAccounts}
                disabled={closeAccountsMutation.isPending}
              >
                Close accounts
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={handleStop}
                disabled={stopMutation.isPending}
              >
                Stop
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 md:grid-cols-4">
              <div>
                <div className="text-xs text-muted-foreground">Status</div>
                <div className="text-sm font-semibold">{session.status}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Trades</div>
                <div className="text-sm font-semibold">
                  {session.totalTrades}
                </div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Volume (USD)</div>
                <div className="text-sm font-semibold">
                  {Number(session.totalVolumeUsd).toFixed(2)}
                </div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Runtime (sec)</div>
                <div className="text-sm font-semibold">
                  {session.runtimeSeconds}
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <div className="text-sm font-semibold">Wallets</div>
              <div className="space-y-2">
                {wallets.slice(0, 10).map((wallet) => (
                  <div
                    key={wallet.id}
                    className="flex items-center justify-between rounded border px-3 py-2 text-sm"
                  >
                    <div className="font-mono">
                      {wallet.walletPublicKey.slice(0, 8)}...
                      {wallet.walletPublicKey.slice(-6)}
                    </div>
                    <div className="text-muted-foreground">
                      {wallet.status}
                    </div>
                    <div>
                      {Number(wallet.solBalance).toFixed(4)} SOL
                    </div>
                  </div>
                ))}
                {wallets.length > 10 && (
                  <div className="text-xs text-muted-foreground">
                    +{wallets.length - 10} more wallets
                  </div>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
