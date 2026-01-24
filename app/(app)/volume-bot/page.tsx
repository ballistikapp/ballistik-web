"use client";

import { useMemo, useState } from "react";
import { useQueryState } from "nuqs";
import { toast } from "sonner";
import {
  ArrowDownRight,
  ArrowUpRight,
  SlidersHorizontal,
  ShieldCheck,
  Minus,
  TrendingUp,
} from "lucide-react";
import { tokenQueryParser } from "@/lib/utils/token-query";
import { trpc } from "@/lib/trpc/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { TokenNotFound } from "@/components/placeholders/token-not-found";
import { DashboardLoading } from "../dashboard/dashboard-loading";
import { Separator } from "@/components/ui/separator";

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
    slippageBps: 1000,
    targetDurationHours: 24,
    sellOnStop: true,
  },
  custom: {
    walletCount: 10,
    fundingPerWalletSol: 0.5,
    minTradeAmountSol: 0.01,
    maxTradeAmountSol: 0.03,
    minIntervalSeconds: 180,
    maxIntervalSeconds: 600,
    sellRatio: 0.9,
    strategy: "neutral" as const,
    slippageBps: 1000,
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
    slippageBps: 1000,
    targetDurationHours: 24,
    sellOnStop: true,
  },
};

export default function VolumeBotPage() {
  const [tokenPublicKey] = useQueryState("token", tokenQueryParser);
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
  const [slippageBps, setSlippageBps] = useState(
    presets.conservative.slippageBps
  );
  const [targetDurationHours, setTargetDurationHours] = useState(
    presets.conservative.targetDurationHours
  );
  const [sellOnStop, setSellOnStop] = useState(presets.conservative.sellOnStop);

  const {
    data: tokenData,
    isLoading,
    error,
    refetch,
  } = trpc.token.getByPublicKey.useQuery(
    { publicKey: tokenPublicKey || "" },
    { enabled: !!tokenPublicKey }
  );

  const {
    data: statusData,
    error: statusError,
    refetch: refetchStatus,
  } = trpc.volumeBot.status.useQuery(
    { tokenPublicKey: tokenPublicKey || undefined },
    {
      enabled: Boolean(tokenPublicKey && tokenData),
      refetchInterval: 10000,
      staleTime: 5000,
      retry: false,
    }
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

  const markCustom = () => {
    setSelectedPreset("custom");
  };

  const handlePresetChange = (preset: keyof typeof presets) => {
    if (preset === "custom") {
      setSelectedPreset("custom");
      return;
    }
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

  if (isLoading) {
    return <DashboardLoading />;
  }

  if (!tokenData) {
    return <TokenNotFound error={error} onRetry={() => refetch()} />;
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex justify-between items-center gap-2 -m-6 px-6 py-10 border-b">
        <div className="flex flex-col gap-3">
          <h1 className="text-4xl">Volume Bot</h1>
        </div>
        <div className="flex flex-col items-end gap-3 text-right text-muted-foreground">
          <p className="leading-tight font-light">
            Configure, start, and manage volume sessions.
            <br />
            Status updates refresh every few seconds.
          </p>
        </div>
      </div>

      <div className="" />

      {!isRunning && (
        <section className="space-y-6 pb-8">
          <Card>
            <CardHeader>
              <CardTitle className="text-primary text-xl">
                Presets & Strategy
              </CardTitle>
            </CardHeader>
            <Separator />
            <CardContent className="space-y-6">
              <div className="space-y-3">
                <div>
                  <Label className="text-base">Preset</Label>
                  <p className="text-sm text-muted-foreground">
                    Choose a starting profile and fine-tune below.
                  </p>
                </div>
                <div className="grid gap-4 md:grid-cols-3">
                  {(["conservative", "aggressive", "custom"] as const).map(
                    (preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => handlePresetChange(preset)}
                      className={`flex flex-col gap-2 rounded-lg bg-background border px-5 py-4 text-left transition ${
                        selectedPreset === preset
                          ? "border-primary"
                          : "border-muted bg-background/50 hover:border-primary/50"
                      }`}
                    >
                    <span className="flex items-center gap-2 text-base font-semibold capitalize">
                      {preset === "conservative" ? (
                        <ShieldCheck className="h-5 w-5" />
                      ) : preset === "aggressive" ? (
                        <TrendingUp className="h-5 w-5" />
                      ) : (
                        <SlidersHorizontal className="h-5 w-5" />
                      )}
                      {preset}
                    </span>
                      <span className="text-sm text-muted-foreground">
                        {preset === "conservative"
                          ? "Balanced trades with slower pacing."
                        : preset === "aggressive"
                        ? "Higher volume with tighter intervals."
                        : "Manual tuning for advanced setups."}
                      </span>
                    </button>
                  )
                  )}
                </div>
              </div>

              <div className="space-y-3">
                <div>
                  <Label className="text-base">Strategy</Label>
                  <p className="text-sm text-muted-foreground">
                    Tune how the bot impacts price action.
                  </p>
                </div>
                <div className="grid gap-4 md:grid-cols-3">
                  {(["neutral", "pump", "dump"] as const).map((option) => (
                    <button
                      key={option}
                      type="button"
                      onClick={() => {
                        setStrategy(option);
                        markCustom();
                      }}
                      className={`flex flex-col gap-2 rounded-lg bg-background border px-5 py-4 text-left transition ${
                        strategy === option
                          ? "border-primary"
                          : "border-muted bg-background/50 hover:border-primary/50"
                      }`}
                    >
                      <span className="flex items-center gap-2 text-base font-semibold capitalize">
                        {option === "neutral" ? (
                          <Minus className="h-5 w-5" />
                        ) : option === "pump" ? (
                          <ArrowUpRight className="h-5 w-5" />
                        ) : (
                          <ArrowDownRight className="h-5 w-5" />
                        )}
                        {option}
                      </span>
                      <span className="text-sm text-muted-foreground">
                        {option === "neutral"
                          ? "Balanced buy/sell activity."
                          : option === "pump"
                          ? "Bias toward buy pressure."
                          : "Bias toward sell pressure."}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-primary text-xl">
                Configuration
              </CardTitle>
            </CardHeader>
            <Separator />
            <CardContent className="space-y-6">
              <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label>Wallet count</Label>
                <Input
                  type="number"
                  min={1}
                  value={walletCount}
                  onChange={(event) =>
                    {
                      setWalletCount(Number(event.target.value));
                      markCustom();
                    }}
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
                    {
                      setFundingPerWalletSol(Number(event.target.value));
                      markCustom();
                    }}
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
                    {
                      setMinTradeAmountSol(Number(event.target.value));
                      markCustom();
                    }}
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
                    {
                      setMaxTradeAmountSol(Number(event.target.value));
                      markCustom();
                    }}
                />
              </div>
              <div className="space-y-2">
                <Label>Min interval (sec)</Label>
                <Input
                  type="number"
                  min={1}
                  value={minIntervalSeconds}
                  onChange={(event) =>
                    {
                      setMinIntervalSeconds(Number(event.target.value));
                      markCustom();
                    }}
                />
              </div>
              <div className="space-y-2">
                <Label>Max interval (sec)</Label>
                <Input
                  type="number"
                  min={1}
                  value={maxIntervalSeconds}
                  onChange={(event) =>
                    {
                      setMaxIntervalSeconds(Number(event.target.value));
                      markCustom();
                    }}
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
                    {
                      setSellRatio(Number(event.target.value));
                      markCustom();
                    }}
                />
              </div>
              <div className="space-y-2">
                <Label>Slippage (bps)</Label>
                <Input
                  type="number"
                  min={0}
                  value={slippageBps}
                  onChange={(event) =>
                    {
                      setSlippageBps(Number(event.target.value));
                      markCustom();
                    }}
                />
              </div>
              <div className="space-y-2">
                <Label>Target duration (hours)</Label>
                <Input
                  type="number"
                  min={0}
                  value={targetDurationHours}
                  onChange={(event) =>
                    {
                      setTargetDurationHours(Number(event.target.value));
                      markCustom();
                    }}
                />
              </div>
              <div className="space-y-2">
                <Label>Sell on stop</Label>
                <Select
                  value={sellOnStop ? "yes" : "no"}
                  onValueChange={(value) => {
                    setSellOnStop(value === "yes");
                    markCustom();
                  }}
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
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-primary text-xl">Preview</CardTitle>
            </CardHeader>
            <Separator />
            <CardContent className="space-y-6">
                <div className="grid gap-4 md:grid-cols-2">
                  <div>
                    <div className="text-xs text-muted-foreground">
                      Total funding
                    </div>
                    <div className="text-lg font-semibold">
                      {totalFunding.toFixed(2)} SOL
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">
                      Trade range
                    </div>
                    <div className="text-lg font-semibold">
                      {minTradeAmountSol.toFixed(3)} -{" "}
                      {maxTradeAmountSol.toFixed(3)} SOL
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">
                      Interval range
                    </div>
                    <div className="text-lg font-semibold">
                      {minIntervalSeconds} - {maxIntervalSeconds} sec
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">Strategy</div>
                    <div className="text-lg font-semibold capitalize">
                      {strategy}
                    </div>
                  </div>
                </div>

            </CardContent>
          </Card>
              <div className="flex items-center justify-end">
                <Button
                  size="lg"
                  onClick={handleStart}
                  disabled={startMutation.isPending || !tokenPublicKey}
                  className="h-14 px-6 text-4xl font-black tracking-tight shadow-lg shadow-lime-400/10 border border-black hover:shadow-xl hover:shadow-lime-300/20 text-black/90 hover:text-black w-full md:w-auto"
                >
                  {startMutation.isPending ? "STARTING..." : "START VOLUME BOT"}
                </Button>
              </div>
        </section>
      )}

      {session && (
        <section className="space-y-6">
          <div className="flex flex-col gap-4 border-b pb-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h2 className="text-2xl font-semibold">Status</h2>
              <p className="text-sm text-muted-foreground">
                Live session activity and wallet health.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
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
          </div>

          <div className="space-y-4">
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
          </div>
        </section>
      )}
    </div>
  );
}
