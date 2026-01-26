"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
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
  ChevronDown,
  ChevronUp,
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
import { TokenNotFound } from "@/components/placeholders/token-not-found";
import { DashboardLoading } from "../../dashboard/dashboard-loading";
import { Separator } from "@/components/ui/separator";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

const DEFAULT_DURATION_SECONDS = 5 * 60;

const presets = {
  conservative: {
    generatedWalletCount: 10,
    fundingPerWalletSol: 0.5,
    minTradeAmountSol: 0.01,
    maxTradeAmountSol: 0.03,
    minIntervalSeconds: 180,
    maxIntervalSeconds: 600,
    sellRatio: 0.9,
    strategy: "neutral" as const,
    buyBiasPct: 50,
    tradeVariancePct: 15,
    slippageBps: 1000,
    targetDurationSeconds: DEFAULT_DURATION_SECONDS,
    strategyTargetSol: 5,
  },
  custom: {
    generatedWalletCount: 10,
    fundingPerWalletSol: 0.5,
    minTradeAmountSol: 0.01,
    maxTradeAmountSol: 0.03,
    minIntervalSeconds: 180,
    maxIntervalSeconds: 600,
    sellRatio: 0.9,
    strategy: "neutral" as const,
    buyBiasPct: 50,
    tradeVariancePct: 15,
    slippageBps: 1000,
    targetDurationSeconds: DEFAULT_DURATION_SECONDS,
    strategyTargetSol: 5,
  },
  aggressive: {
    generatedWalletCount: 30,
    fundingPerWalletSol: 1,
    minTradeAmountSol: 0.05,
    maxTradeAmountSol: 0.15,
    minIntervalSeconds: 30,
    maxIntervalSeconds: 180,
    sellRatio: 0.7,
    strategy: "pump" as const,
    buyBiasPct: 80,
    tradeVariancePct: 25,
    slippageBps: 1000,
    targetDurationSeconds: DEFAULT_DURATION_SECONDS,
    strategyTargetSol: 5,
  },
};

const formatDuration = (seconds: number) => {
  if (!Number.isFinite(seconds) || seconds <= 0) return "—";
  const totalMinutes = Math.floor(seconds / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0 && minutes > 0) {
    return `${hours}h ${minutes}m`;
  }
  if (hours > 0) {
    return `${hours}h`;
  }
  return `${minutes}m`;
};

const formatSolEstimate = (value?: number | null) => {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "—";
  }
  if (value > 0 && value < 0.001) {
    return "<0.001 SOL";
  }
  return `${value.toFixed(3)} SOL`;
};

export default function VolumeBotStartPage() {
  const [tokenPublicKey] = useQueryState("token", tokenQueryParser);
  const router = useRouter();
  const [selectedPreset, setSelectedPreset] =
    useState<keyof typeof presets>("conservative");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [walletsExpanded, setWalletsExpanded] = useState(false);
  const [isRefreshingWallets, setIsRefreshingWallets] = useState(false);

  const [generatedWalletCount, setGeneratedWalletCount] = useState(
    presets.conservative.generatedWalletCount
  );
  const [selectedWalletPublicKeys, setSelectedWalletPublicKeys] = useState<
    string[]
  >([]);
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
  const [buyBiasPct, setBuyBiasPct] = useState(presets.conservative.buyBiasPct);
  const [tradeVariancePct, setTradeVariancePct] = useState(
    presets.conservative.tradeVariancePct
  );
  const [slippageBps, setSlippageBps] = useState(
    presets.conservative.slippageBps
  );
  const [durationPreset, setDurationPreset] = useState(
    String(presets.conservative.targetDurationSeconds)
  );
  const [customDurationSeconds, setCustomDurationSeconds] = useState(
    DEFAULT_DURATION_SECONDS
  );
  const [strategyTargetSol, setStrategyTargetSol] = useState(
    presets.conservative.strategyTargetSol
  );

  const {
    data: tokenData,
    isLoading,
    error,
    refetch,
  } = trpc.token.getByPublicKey.useQuery(
    { publicKey: tokenPublicKey || "" },
    { enabled: !!tokenPublicKey }
  );

  const { data: statusData } = trpc.volumeBot.status.useQuery(
    { tokenPublicKey: tokenPublicKey || undefined },
    {
      enabled: Boolean(tokenPublicKey && tokenData),
      refetchInterval: 10000,
      staleTime: 5000,
      retry: false,
    }
  );

  const eligibleWalletsQuery = trpc.volumeBot.eligibleWallets.useQuery(
    { tokenPublicKey: tokenPublicKey || "" },
    { enabled: Boolean(tokenPublicKey && tokenData) }
  );

  const selectionSummaryQuery = trpc.volumeBot.selectionSummary.useQuery(
    {
      tokenPublicKey: tokenPublicKey || "",
      selectedWalletPublicKeys,
      strategy,
      targetSol: strategyTargetSol,
    },
    {
      enabled:
        Boolean(tokenPublicKey && tokenData) &&
        strategy === "dump" &&
        selectedWalletPublicKeys.length > 0 &&
        strategyTargetSol > 0,
      retry: false,
    }
  );

  const startMutation = trpc.volumeBot.start.useMutation({
    onError: (error) => {
      toast.error(error.message || "Failed to start volume bot");
    },
  });

  const session = statusData?.session;
  const isRunning =
    session?.status === "RUNNING" ||
    session?.status === "STOP_REQUESTED" ||
    session?.status === "STOPPING";

  const totalFunding = useMemo(
    () => generatedWalletCount * fundingPerWalletSol,
    [generatedWalletCount, fundingPerWalletSol]
  );
  const totalWallets = selectedWalletPublicKeys.length + generatedWalletCount;
  const eligibleWallets = eligibleWalletsQuery.data?.wallets ?? [];
  const selectedTokenBalance = useMemo(() => {
    if (selectedWalletPublicKeys.length === 0) {
      return 0;
    }
    return eligibleWallets
      .filter((wallet) => selectedWalletPublicKeys.includes(wallet.publicKey))
      .reduce((sum, wallet) => sum + wallet.tokenBalanceUi, 0);
  }, [eligibleWallets, selectedWalletPublicKeys]);
  const visibleWallets = useMemo(() => {
    return eligibleWallets
      .filter((wallet) => wallet.tokenBalanceUi > 0)
      .sort((a, b) => b.tokenBalanceUi - a.tokenBalanceUi);
  }, [eligibleWallets]);
  const targetDurationSeconds = useMemo(() => {
    if (durationPreset === "custom") {
      const seconds = Number.isFinite(customDurationSeconds)
        ? customDurationSeconds
        : 0;
      return Math.max(60, Math.round(seconds));
    }
    const presetValue = Number.parseInt(durationPreset, 10);
    return Number.isFinite(presetValue) && presetValue > 0 ? presetValue : 0;
  }, [durationPreset, customDurationSeconds]);

  const markCustom = () => {
    setSelectedPreset("custom");
  };

  const toggleWallet = (walletPublicKey: string) => {
    setSelectedWalletPublicKeys((current) => {
      if (current.includes(walletPublicKey)) {
        return current.filter((key) => key !== walletPublicKey);
      }
      return [...current, walletPublicKey];
    });
  };

  const handlePresetChange = (preset: keyof typeof presets) => {
    if (preset === "custom") {
      setSelectedPreset("custom");
      return;
    }
    const nextPreset = presets[preset];
    setSelectedPreset(preset);
    setGeneratedWalletCount(nextPreset.generatedWalletCount);
    setFundingPerWalletSol(nextPreset.fundingPerWalletSol);
    setMinTradeAmountSol(nextPreset.minTradeAmountSol);
    setMaxTradeAmountSol(nextPreset.maxTradeAmountSol);
    setMinIntervalSeconds(nextPreset.minIntervalSeconds);
    setMaxIntervalSeconds(nextPreset.maxIntervalSeconds);
    setSellRatio(nextPreset.sellRatio);
    setStrategy(nextPreset.strategy);
    setBuyBiasPct(nextPreset.buyBiasPct);
    setTradeVariancePct(nextPreset.tradeVariancePct);
    setSlippageBps(nextPreset.slippageBps);
    setDurationPreset(String(nextPreset.targetDurationSeconds));
    setCustomDurationSeconds(nextPreset.targetDurationSeconds);
    setStrategyTargetSol(nextPreset.strategyTargetSol);
  };

  const handleStart = async () => {
    if (!tokenPublicKey) {
      toast.error("Select a token first");
      return;
    }
    if (strategy === "dump" && selectedWalletPublicKeys.length === 0) {
      toast.error("Select at least one wallet for dump");
      return;
    }
    if (strategy !== "neutral" && strategyTargetSol <= 0) {
      toast.error("Set a target SOL amount for pump or dump");
      return;
    }
    if (targetDurationSeconds <= 0) {
      toast.error("Select a duration for the run");
      return;
    }
    setConfirmOpen(true);
    if (strategy === "dump") {
      await selectionSummaryQuery.refetch();
    }
  };

  const handleConfirmStart = async () => {
    const latestSummary =
      strategy === "dump" ? (await selectionSummaryQuery.refetch()).data : null;
    if (strategy === "dump" && latestSummary?.insufficient) {
      toast.warning("Dump target capped by available balances");
    }
    const result = await startMutation.mutateAsync({
      tokenPublicKey: tokenPublicKey || "",
      config: {
        generatedWalletCount,
        selectedWalletPublicKeys,
        fundingPerWalletSol,
        minTradeAmountSol,
        maxTradeAmountSol,
        minIntervalSeconds,
        maxIntervalSeconds,
        sellRatio,
        strategy,
        buyBiasPct,
        tradeVariancePct,
        slippageBps,
        strategyTargetSol:
          strategy !== "neutral" ? strategyTargetSol : undefined,
        targetDurationSeconds,
      },
    });
    toast.success("Volume bot started");
    setConfirmOpen(false);
    router.push(`/volume-bot/${result.sessionId}?token=${tokenPublicKey}`);
  };

  if (isLoading) {
    return <DashboardLoading />;
  }

  if (!tokenData) {
    return <TokenNotFound error={error} onRetry={() => refetch()} />;
  }

  const inlineWarning =
    strategy === "dump" && selectionSummaryQuery.data?.insufficient;
  const targetApplied = selectionSummaryQuery.data?.targetSolApplied;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex justify-between items-center gap-2 -m-6 px-6 py-10 border-b">
        <div className="flex flex-col gap-3">
          <Link
            href={`/volume-bot${tokenPublicKey ? `?token=${tokenPublicKey}` : ""}`}
            className="text-sm text-muted-foreground hover:underline"
          >
            Back to runs
          </Link>
          <h1 className="text-4xl">Start Volume Bot</h1>
        </div>
        <div className="flex flex-col items-end gap-3 text-right text-muted-foreground">
          <p className="leading-tight font-light">
            Configure, start, and manage volume sessions.
            <br />
            Status updates refresh every few seconds.
          </p>
        </div>
      </div>

      <div />

      {isRunning && session && (
        <Card>
          <CardHeader>
            <CardTitle className="text-primary text-xl">
              Active session running
            </CardTitle>
          </CardHeader>
          <Separator />
          <CardContent className="flex items-center justify-between gap-4">
            <div>
              <div className="text-sm text-muted-foreground">
                A run is already active for this token.
              </div>
              <div className="text-sm font-semibold">{session.status}</div>
            </div>
            <Button asChild variant="outline">
              <Link href={`/volume-bot/${session.id}?token=${tokenPublicKey}`}>
                View run
              </Link>
            </Button>
          </CardContent>
        </Card>
      )}

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
          <CardHeader className="flex flex-row items-center justify-between">
            <button
              type="button"
              onClick={() => setWalletsExpanded((current) => !current)}
              aria-expanded={walletsExpanded}
              className="flex flex-1 items-center justify-between text-left"
            >
              <div className="space-y-1">
                <CardTitle className="text-primary text-xl">
                  Wallet selection
                </CardTitle>
                <div className="text-xs text-muted-foreground">
                  {selectedWalletPublicKeys.length} selected ·{" "}
                  {selectedTokenBalance.toFixed(4)} tokens
                </div>
              </div>
              {walletsExpanded ? (
                <ChevronUp className="h-4 w-4" />
              ) : (
                <ChevronDown className="h-4 w-4" />
              )}
            </button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={isRefreshingWallets || eligibleWalletsQuery.isFetching}
              onClick={async () => {
                setIsRefreshingWallets(true);
                try {
                  await Promise.all([
                    eligibleWalletsQuery.refetch(),
                    strategy === "dump"
                      ? selectionSummaryQuery.refetch()
                      : Promise.resolve(),
                  ]);
                } finally {
                  setIsRefreshingWallets(false);
                }
              }}
            >
              {isRefreshingWallets || eligibleWalletsQuery.isFetching ? (
                <>
                  <Spinner className="mr-2" />
                  Refreshing
                </>
              ) : (
                "Refresh"
              )}
            </Button>
          </CardHeader>
          <Separator />
          <CardContent className="space-y-4">
            <div className="text-sm text-muted-foreground">
              Select existing wallets to include in this run (main wallet
              excluded).
            </div>
            {walletsExpanded ? (
              <div className="space-y-2">
                {eligibleWalletsQuery.isLoading && (
                  <div className="text-sm text-muted-foreground flex items-center gap-2">
                    <Spinner />
                    Loading wallets...
                  </div>
                )}
                {!eligibleWalletsQuery.isLoading &&
                  visibleWallets.length === 0 && (
                    <div className="text-sm text-muted-foreground">
                      No eligible wallets found for this token.
                    </div>
                  )}
                {!eligibleWalletsQuery.isLoading &&
                  visibleWallets.map((wallet) => (
                    <label
                      key={wallet.publicKey}
                      className="flex items-center justify-between rounded border px-3 py-2 text-sm"
                    >
                      <div className="flex items-center gap-3">
                        <Checkbox
                          checked={selectedWalletPublicKeys.includes(
                            wallet.publicKey
                          )}
                          onCheckedChange={() => toggleWallet(wallet.publicKey)}
                        />
                        <div className="font-mono">
                          {wallet.publicKey.slice(0, 8)}...
                          {wallet.publicKey.slice(-6)}
                        </div>
                        <Badge variant="outline">{wallet.type}</Badge>
                      </div>
                      <div className="text-right text-muted-foreground">
                        <div>{wallet.tokenBalanceUi.toFixed(4)} tokens</div>
                        <div className="text-xs">
                          {(() => {
                            const solDisplay = formatSolEstimate(
                              wallet.tokenBalanceSol
                            );
                            return solDisplay === "—"
                              ? "—"
                              : `~${solDisplay}`;
                          })()}
                        </div>
                      </div>
                    </label>
                  ))}
              </div>
            ) : (
              <div className="text-xs text-muted-foreground">
                Wallet list hidden.
              </div>
            )}
            {inlineWarning && (
              <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                Selected wallets can only sell ~
                {selectionSummaryQuery.data?.estimatedNetSolOut.toFixed(2)} SOL.
                The dump target will be capped to {targetApplied?.toFixed(2)}{" "}
                SOL.
              </div>
            )}
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
                <Label>Generated wallets</Label>
                <Input
                  type="number"
                  min={0}
                  value={generatedWalletCount}
                  onChange={(event) => {
                    setGeneratedWalletCount(Number(event.target.value));
                    markCustom();
                  }}
                />
                <p className="text-xs text-muted-foreground">
                  New wallets created and funded for this run.
                </p>
              </div>
              <div className="space-y-2">
                <Label>Funding per generated wallet (SOL)</Label>
                <Input
                  type="number"
                  min={0}
                  step={0.01}
                  value={fundingPerWalletSol}
                  onChange={(event) => {
                    setFundingPerWalletSol(Number(event.target.value));
                    markCustom();
                  }}
                />
                <p className="text-xs text-muted-foreground">
                  SOL sent from the main wallet to each generated wallet.
                </p>
              </div>
              {strategy !== "neutral" && (
                <div className="space-y-2">
                  <Label>Target net SOL ({strategy})</Label>
                  <Input
                    type="number"
                    min={0}
                    step={0.01}
                    value={strategyTargetSol}
                    onChange={(event) => {
                      setStrategyTargetSol(Number(event.target.value));
                      markCustom();
                    }}
                  />
                  <p className="text-xs text-muted-foreground">
                    Net SOL change from bot trades on the bonding curve.
                  </p>
                </div>
              )}
              <div className="space-y-2">
                <Label>Buy bias (%)</Label>
                <Input
                  type="number"
                  min={0}
                  max={100}
                  step={1}
                  value={buyBiasPct}
                  onChange={(event) => {
                    setBuyBiasPct(Number(event.target.value));
                    markCustom();
                  }}
                />
                <p className="text-xs text-muted-foreground">
                  Higher means more buys. Dump flips the bias toward sells.
                </p>
              </div>
              <div className="space-y-2">
                <Label>Trade variance (%)</Label>
                <Input
                  type="number"
                  min={0}
                  max={100}
                  step={1}
                  value={tradeVariancePct}
                  onChange={(event) => {
                    setTradeVariancePct(Number(event.target.value));
                    markCustom();
                  }}
                />
                <p className="text-xs text-muted-foreground">
                  Random variance applied to trade size around the target.
                </p>
              </div>
              <div className="space-y-2">
                <Label>Min trade (SOL)</Label>
                <Input
                  type="number"
                  min={0}
                  step={0.001}
                  value={minTradeAmountSol}
                  onChange={(event) => {
                    setMinTradeAmountSol(Number(event.target.value));
                    markCustom();
                  }}
                />
                <p className="text-xs text-muted-foreground">
                  Smallest trade size the bot will attempt.
                </p>
              </div>
              <div className="space-y-2">
                <Label>Max trade (SOL)</Label>
                <Input
                  type="number"
                  min={0}
                  step={0.001}
                  value={maxTradeAmountSol}
                  onChange={(event) => {
                    setMaxTradeAmountSol(Number(event.target.value));
                    markCustom();
                  }}
                />
                <p className="text-xs text-muted-foreground">
                  Largest trade size the bot will attempt.
                </p>
              </div>
              <div className="space-y-2">
                <Label>Min interval (sec)</Label>
                <Input
                  type="number"
                  min={1}
                  value={minIntervalSeconds}
                  onChange={(event) => {
                    setMinIntervalSeconds(Number(event.target.value));
                    markCustom();
                  }}
                />
                <p className="text-xs text-muted-foreground">
                  Shortest delay between wallet ticks.
                </p>
              </div>
              <div className="space-y-2">
                <Label>Max interval (sec)</Label>
                <Input
                  type="number"
                  min={1}
                  value={maxIntervalSeconds}
                  onChange={(event) => {
                    setMaxIntervalSeconds(Number(event.target.value));
                    markCustom();
                  }}
                />
                <p className="text-xs text-muted-foreground">
                  Longest delay between wallet ticks.
                </p>
              </div>
              <div className="space-y-2">
                <Label>Sell ratio</Label>
                <Input
                  type="number"
                  min={0}
                  max={1}
                  step={0.1}
                  value={sellRatio}
                  onChange={(event) => {
                    setSellRatio(Number(event.target.value));
                    markCustom();
                  }}
                />
                <p className="text-xs text-muted-foreground">
                  Portion of token balance sold on each sell action.
                </p>
              </div>
              <div className="space-y-2">
                <Label>Slippage (bps)</Label>
                <Input
                  type="number"
                  min={0}
                  value={slippageBps}
                  onChange={(event) => {
                    setSlippageBps(Number(event.target.value));
                    markCustom();
                  }}
                />
                <p className="text-xs text-muted-foreground">
                  Max price movement tolerated for trades.
                </p>
              </div>
              <div className="space-y-2">
                <Label>Duration</Label>
                <Select
                  value={durationPreset}
                  onValueChange={(value) => {
                    setDurationPreset(value);
                    markCustom();
                  }}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select duration" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="300">5 minutes (300s)</SelectItem>
                    <SelectItem value="900">15 minutes (900s)</SelectItem>
                    <SelectItem value="3600">1 hour (3600s)</SelectItem>
                    <SelectItem value="21600">6 hours (21600s)</SelectItem>
                    <SelectItem value="86400">24 hours (86400s)</SelectItem>
                    <SelectItem value="custom">Custom</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Total run duration before auto-stop.
                </p>
                {durationPreset === "custom" && (
                  <Input
                    type="number"
                    min={60}
                    step={1}
                    value={customDurationSeconds}
                    onChange={(event) => {
                      setCustomDurationSeconds(Number(event.target.value));
                      markCustom();
                    }}
                  />
                )}
                {durationPreset === "custom" && (
                  <p className="text-xs text-muted-foreground">
                    Custom duration in seconds.
                  </p>
                )}
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
                  Total wallets
                </div>
                <div className="text-lg font-semibold">{totalWallets}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">
                  Generated funding
                </div>
                <div className="text-lg font-semibold">
                  {totalFunding.toFixed(2)} SOL
                </div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Trade range</div>
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
                <div className="text-xs text-muted-foreground">Duration</div>
                <div className="text-lg font-semibold">
                  {formatDuration(targetDurationSeconds)}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
        <div className="flex items-center justify-end">
          <Button
            size="lg"
            onClick={handleStart}
            disabled={startMutation.isPending || !tokenPublicKey || isRunning}
            className="h-14 px-6 text-4xl font-black tracking-tight shadow-lg shadow-lime-400/10 border border-black hover:shadow-xl hover:shadow-lime-300/20 text-black/90 hover:text-black w-full md:w-auto"
          >
            {startMutation.isPending ? "STARTING..." : "START VOLUME BOT"}
          </Button>
        </div>
      </section>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm volume bot run</AlertDialogTitle>
            <AlertDialogDescription>
              Review the target and wallet selection before starting.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-3 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Strategy</span>
              <span className="font-semibold capitalize">{strategy}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Selected wallets</span>
              <span className="font-semibold">
                {selectedWalletPublicKeys.length}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Generated wallets</span>
              <span className="font-semibold">{generatedWalletCount}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Duration</span>
              <span className="font-semibold">
                {formatDuration(targetDurationSeconds)}
              </span>
            </div>
            {strategy !== "neutral" && (
              <>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Target SOL</span>
                  <span className="font-semibold">
                    {strategyTargetSol.toFixed(2)}
                  </span>
                </div>
                {strategy === "dump" && selectionSummaryQuery.data && (
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">
                      Applied target
                    </span>
                    <span className="font-semibold">
                      {selectionSummaryQuery.data.targetSolApplied?.toFixed(2)}
                    </span>
                  </div>
                )}
              </>
            )}
            {strategy === "dump" &&
              selectionSummaryQuery.data?.insufficient && (
                <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                  Selected wallets cannot cover the target. The run will cap to{" "}
                  {selectionSummaryQuery.data.targetSolApplied?.toFixed(2)} SOL.
                </div>
              )}
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmStart}
              disabled={startMutation.isPending}
            >
              {startMutation.isPending ? "Starting..." : "Start bot"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
