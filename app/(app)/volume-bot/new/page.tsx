"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { useQueryState } from "nuqs";
import { toast } from "sonner";
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
import { Spinner } from "@/components/ui/spinner";
import type { VolumeBotConfigInput } from "@/server/schemas/volume-bot.schema";
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

type RangeInput = {
  solMin: number;
  solMax: number;
  increment: number | null;
  probability: number;
  intervalMin: number;
  intervalMax: number;
  direction: "buy" | "sell" | "both";
  buyProbability?: number;
};

const defaultRange: RangeInput = {
  solMin: 0.01,
  solMax: 0.03,
  increment: 0.01,
  probability: 1,
  intervalMin: 180,
  intervalMax: 600,
  direction: "both",
  buyProbability: 0.5,
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

const parseDateTime = (value: string) => {
  if (!value) return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
};

const formatNumber = (value?: number | null, fallback = "—") => {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return fallback;
  }
  return value.toFixed(2);
};

const clampNumber = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

export default function VolumeBotStartPage() {
  const [tokenPublicKey] = useQueryState("token", tokenQueryParser);
  const router = useRouter();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [walletsExpanded, setWalletsExpanded] = useState(false);
  const [isRefreshingWallets, setIsRefreshingWallets] = useState(false);
  const [ranges, setRanges] = useState<RangeInput[]>([defaultRange]);

  const [generatedWalletCount, setGeneratedWalletCount] = useState(10);
  const [selectedWalletPublicKeys, setSelectedWalletPublicKeys] = useState<
    string[]
  >([]);
  const [fundingPerGeneratedWallet, setFundingPerGeneratedWallet] = useState(0.5);
  const [topUpAmount, setTopUpAmount] = useState(0.01);
  const [slippageBps, setSlippageBps] = useState(1000);
  const [sellFallbackRatio, setSellFallbackRatio] = useState(0.5);
  const [pauseOnHighSlippage, setPauseOnHighSlippage] = useState(true);
  const [maxSlippageFailures, setMaxSlippageFailures] = useState(3);
  const [targetDurationSeconds, setTargetDurationSeconds] = useState(
    DEFAULT_DURATION_SECONDS
  );
  const [scheduledStartAt, setScheduledStartAt] = useState("");
  const [scheduledStopAt, setScheduledStopAt] = useState("");
  const [fundingTouched, setFundingTouched] = useState(false);
  const [presetName, setPresetName] = useState("");
  const [selectedPresetId, setSelectedPresetId] = useState<string | null>(null);

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

  const presetsQuery = trpc.volumeBot.listPresets.useQuery({}, { retry: false });

  const savePresetMutation = trpc.volumeBot.savePreset.useMutation({
    onSuccess: (preset) => {
      toast.success("Preset saved");
      presetsQuery.refetch();
      setSelectedPresetId(preset.id);
      setPresetName(preset.name);
    },
    onError: (presetError) => {
      toast.error(presetError.message || "Failed to save preset");
    },
  });

  const deletePresetMutation = trpc.volumeBot.deletePreset.useMutation({
    onSuccess: () => {
      toast.success("Preset deleted");
      presetsQuery.refetch();
      setSelectedPresetId(null);
      setPresetName("");
    },
    onError: (presetError) => {
      toast.error(presetError.message || "Failed to delete preset");
    },
  });

  const totalWallets = selectedWalletPublicKeys.length + generatedWalletCount;
  const probabilitySum = useMemo(
    () => ranges.reduce((sum, range) => sum + range.probability, 0),
    [ranges]
  );
  const selectedPreset = useMemo(() => {
    return presetsQuery.data?.find((preset) => preset.id === selectedPresetId);
  }, [presetsQuery.data, selectedPresetId]);

  const configInput = useMemo(
    () => ({
      ranges: ranges.map((range) => ({
        ...range,
        increment:
          range.increment !== null && range.increment > 0
            ? range.increment
            : null,
        buyProbability: range.direction === "both" ? range.buyProbability : undefined,
      })),
      walletConfig: {
        generatedWalletCount,
        selectedWalletPublicKeys,
        fundingPerGeneratedWallet,
        topUpAmount,
      },
      behaviorConfig: {
        slippageBps,
        sellFallbackRatio,
        pauseOnHighSlippage,
        maxSlippageFailures,
      },
      targetDurationSeconds,
    }),
    [
      ranges,
      generatedWalletCount,
      selectedWalletPublicKeys,
      fundingPerGeneratedWallet,
      topUpAmount,
      slippageBps,
      sellFallbackRatio,
      pauseOnHighSlippage,
      maxSlippageFailures,
      targetDurationSeconds,
    ]
  );

  const selectionSummaryQuery = trpc.volumeBot.selectionSummary.useQuery(
    {
      tokenPublicKey: tokenPublicKey || "",
      config: configInput,
    },
    {
      enabled:
        Boolean(tokenPublicKey && tokenData) &&
        ranges.length > 0 &&
        totalWallets > 0 &&
        targetDurationSeconds > 0 &&
        Math.abs(probabilitySum - 1) < 0.001,
      retry: false,
    }
  );

  const startMutation = trpc.volumeBot.start.useMutation({
    onError: (startError) => {
      toast.error(startError.message || "Failed to start volume bot");
    },
  });

  const session = statusData?.session;
  const isRunning =
    session?.status === "RUNNING" ||
    session?.status === "STOP_REQUESTED" ||
    session?.status === "STOPPING" ||
    session?.status === "SCHEDULED";

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

  const totalFunding = useMemo(
    () => generatedWalletCount * fundingPerGeneratedWallet,
    [generatedWalletCount, fundingPerGeneratedWallet]
  );

  const localPreflight = useMemo(() => {
    if (ranges.length === 0 || totalWallets <= 0 || targetDurationSeconds <= 0) {
      return null;
    }
    let netSolDirection = 0;
    let avgIntervalWeighted = 0;
    let avgTradeSizeWeighted = 0;
    let minVolumePerMinute = 0;
    let maxVolumePerMinute = 0;
    let minNetSolPerTrade = 0;
    let maxNetSolPerTrade = 0;
    for (const range of ranges) {
      const avgAmount = (range.solMin + range.solMax) / 2;
      const avgInterval = (range.intervalMin + range.intervalMax) / 2;
      avgIntervalWeighted += range.probability * avgInterval;
      avgTradeSizeWeighted += range.probability * avgAmount;
      if (range.direction === "buy") {
        netSolDirection += range.probability * avgAmount;
        minNetSolPerTrade += range.probability * range.solMin;
        maxNetSolPerTrade += range.probability * range.solMax;
      } else if (range.direction === "sell") {
        netSolDirection -= range.probability * avgAmount;
        minNetSolPerTrade -= range.probability * range.solMax;
        maxNetSolPerTrade -= range.probability * range.solMin;
      } else {
        const buyProbability = range.buyProbability ?? 0;
        const sellProbability = 1 - buyProbability;
        netSolDirection +=
          range.probability * avgAmount * (2 * buyProbability - 1);
        minNetSolPerTrade +=
          range.probability *
          (buyProbability * range.solMin - sellProbability * range.solMax);
        maxNetSolPerTrade +=
          range.probability *
          (buyProbability * range.solMax - sellProbability * range.solMin);
      }
      minVolumePerMinute +=
        (range.solMin * 60) /
        range.intervalMax *
        range.probability *
        totalWallets;
      maxVolumePerMinute +=
        (range.solMax * 60) /
        range.intervalMin *
        range.probability *
        totalWallets;
    }
    const estimatedTradesPerWallet =
      avgIntervalWeighted > 0 ? targetDurationSeconds / avgIntervalWeighted : 0;
    const totalExpectedVolume =
      estimatedTradesPerWallet * avgTradeSizeWeighted * totalWallets;
    const bufferMultiplier =
      netSolDirection > 0 && totalExpectedVolume > 0
        ? clampNumber(1 + netSolDirection / totalExpectedVolume, 1, 2)
        : 1;
    const baseFunding = estimatedTradesPerWallet * avgTradeSizeWeighted;
    const suggestedFunding =
      Math.ceil(baseFunding * bufferMultiplier * 1.1 * 100) / 100;
    const minutes = targetDurationSeconds / 60;
    const tradesPerMinute =
      avgIntervalWeighted > 0 ? (60 / avgIntervalWeighted) * totalWallets : 0;
    return {
      netSolDirection,
      avgIntervalWeighted,
      avgTradeSizeWeighted,
      estimatedTradesPerWallet,
      suggestedFunding,
      volumePerMinute: {
        min: minVolumePerMinute,
        max: maxVolumePerMinute,
      },
      totalVolume: {
        min: minVolumePerMinute * minutes,
        max: maxVolumePerMinute * minutes,
      },
      netSolRangePerMinute: {
        min: minNetSolPerTrade * tradesPerMinute,
        max: maxNetSolPerTrade * tradesPerMinute,
      },
      netSolRangeTotal: {
        min: minNetSolPerTrade * tradesPerMinute * minutes,
        max: maxNetSolPerTrade * tradesPerMinute * minutes,
      },
    };
  }, [ranges, totalWallets, targetDurationSeconds]);

  const selectionSummary = selectionSummaryQuery.data;
  const effectivePreflight = selectionSummary ?? localPreflight;
  const netSolDirection = effectivePreflight?.netSolDirection ?? 0;
  const netDirectionLabel =
    netSolDirection > 0 ? "Net buy" : netSolDirection < 0 ? "Net sell" : "Neutral";
  const suggestedFunding =
    selectionSummary?.suggestedFundingPerGeneratedWallet ??
    localPreflight?.suggestedFunding;
  const fundingBelowSuggested =
    suggestedFunding !== undefined
      ? fundingPerGeneratedWallet < suggestedFunding
      : false;
  const sellWarning = selectionSummary?.sellWarning ?? false;
  const totalSellableValue = selectionSummary?.totalSellableValue ?? null;

  useEffect(() => {
    if (fundingTouched) {
      return;
    }
    if (suggestedFunding && Number.isFinite(suggestedFunding)) {
      setFundingPerGeneratedWallet(suggestedFunding);
    }
  }, [suggestedFunding, fundingTouched]);

  const updateRange = (
    index: number,
    key: keyof RangeInput,
    value: RangeInput[keyof RangeInput]
  ) => {
    setRanges((current) =>
      current.map((range, rangeIndex) =>
        rangeIndex === index ? { ...range, [key]: value } : range
      )
    );
  };

  const addRange = () => {
    if (ranges.length >= 5) {
      toast.error("Max 5 ranges allowed");
      return;
    }
    setRanges((current) => [...current, { ...defaultRange, probability: 0 }]);
  };

  const removeRange = (index: number) => {
    setRanges((current) => current.filter((_, rangeIndex) => rangeIndex !== index));
  };

  const toggleWallet = (walletPublicKey: string) => {
    setSelectedWalletPublicKeys((current) => {
      if (current.includes(walletPublicKey)) {
        return current.filter((key) => key !== walletPublicKey);
      }
      return [...current, walletPublicKey];
    });
  };

  const handleApplyPreset = () => {
    if (!selectedPreset) {
      toast.error("Select a preset to apply");
      return;
    }
    const presetConfig = selectedPreset.config as VolumeBotConfigInput;
    if (!presetConfig || !Array.isArray(presetConfig.ranges)) {
      toast.error("Preset config is invalid");
      return;
    }
    setRanges(
      presetConfig.ranges.map((range) => ({
        ...range,
        increment:
          range.increment !== null && range.increment !== undefined
            ? range.increment
            : null,
        buyProbability:
          range.direction === "both"
            ? range.buyProbability ?? 0.5
            : undefined,
      }))
    );
    setGeneratedWalletCount(presetConfig.walletConfig.generatedWalletCount);
    setSelectedWalletPublicKeys(presetConfig.walletConfig.selectedWalletPublicKeys);
    setFundingPerGeneratedWallet(presetConfig.walletConfig.fundingPerGeneratedWallet);
    setTopUpAmount(presetConfig.walletConfig.topUpAmount);
    setSlippageBps(presetConfig.behaviorConfig.slippageBps);
    setSellFallbackRatio(presetConfig.behaviorConfig.sellFallbackRatio);
    setPauseOnHighSlippage(presetConfig.behaviorConfig.pauseOnHighSlippage);
    setMaxSlippageFailures(presetConfig.behaviorConfig.maxSlippageFailures);
    setTargetDurationSeconds(presetConfig.targetDurationSeconds);
    setFundingTouched(true);
    setPresetName(selectedPreset.name);
  };

  const handleSavePreset = async () => {
    const trimmedName = presetName.trim();
    if (!trimmedName) {
      toast.error("Preset name required");
      return;
    }
    await savePresetMutation.mutateAsync({
      name: trimmedName,
      config: configInput,
    });
  };

  const handleDeletePreset = async () => {
    if (!selectedPreset) {
      toast.error("Select a preset to delete");
      return;
    }
    await deletePresetMutation.mutateAsync({ presetId: selectedPreset.id });
  };

  const handleStart = async () => {
    if (!tokenPublicKey) {
      toast.error("Select a token first");
      return;
    }
    if (ranges.length === 0) {
      toast.error("Add at least one range");
      return;
    }
    if (Math.abs(probabilitySum - 1) >= 0.001) {
      toast.error("Range probabilities must sum to 1.0");
      return;
    }
    if (totalWallets < 1 || totalWallets > 50) {
      toast.error("Total wallets must be between 1 and 50");
      return;
    }
    if (targetDurationSeconds <= 0) {
      toast.error("Duration must be at least 1 second");
      return;
    }
    const missingBuyProbability = ranges.some(
      (range) =>
        range.direction === "both" &&
        (range.buyProbability === undefined || Number.isNaN(range.buyProbability))
    );
    if (missingBuyProbability) {
      toast.error("Set buy probability for ranges with direction both");
      return;
    }
    if (netSolDirection < 0 && selectedWalletPublicKeys.length === 0) {
      toast.error("Net sell sessions require wallets with token holdings");
      return;
    }
    if (
      netSolDirection < 0 &&
      totalSellableValue !== null &&
      totalSellableValue <= 0
    ) {
      toast.error("Selected wallets have no tokens to sell");
      return;
    }
    setConfirmOpen(true);
  };

  const handleConfirmStart = async () => {
    const scheduledStart = parseDateTime(scheduledStartAt);
    const scheduledStop = parseDateTime(scheduledStopAt);
    const result = await startMutation.mutateAsync({
      tokenPublicKey: tokenPublicKey || "",
      config: configInput,
      scheduledStartAt: scheduledStart,
      scheduledStopAt: scheduledStop,
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
            <CardTitle className="text-primary text-xl">Presets</CardTitle>
          </CardHeader>
          <Separator />
          <CardContent className="space-y-4">
            <div className="grid gap-3 md:grid-cols-3">
              <div className="space-y-2">
                <Label>Preset</Label>
                <Select
                  value={selectedPresetId ?? ""}
                  onValueChange={(value) => {
                    const nextValue = value || null;
                    setSelectedPresetId(nextValue);
                    const preset = presetsQuery.data?.find(
                      (item) => item.id === nextValue
                    );
                    setPresetName(preset?.name ?? "");
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select preset" />
                  </SelectTrigger>
                  <SelectContent>
                    {(presetsQuery.data ?? []).map((preset) => (
                      <SelectItem key={preset.id} value={preset.id}>
                        {preset.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Name</Label>
                <Input
                  value={presetName}
                  onChange={(event) => setPresetName(event.target.value)}
                />
              </div>
              <div className="flex items-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleApplyPreset}
                  disabled={!selectedPresetId}
                >
                  Apply
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleDeletePreset}
                  disabled={!selectedPresetId || deletePresetMutation.isPending}
                >
                  Delete
                </Button>
                <Button
                  type="button"
                  onClick={handleSavePreset}
                  disabled={savePresetMutation.isPending}
                >
                  Save
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-primary text-xl">Ranges</CardTitle>
            <Button type="button" variant="outline" size="sm" onClick={addRange}>
              Add range
            </Button>
          </CardHeader>
          <Separator />
          <CardContent className="space-y-4">
            {ranges.map((range, index) => (
              <div key={index} className="rounded border p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-semibold">Range {index + 1}</div>
                  {ranges.length > 1 && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => removeRange(index)}
                    >
                      Remove
                    </Button>
                  )}
                </div>
                <div className="grid gap-3 md:grid-cols-4">
                  <div className="space-y-2">
                    <Label>solMin</Label>
                    <Input
                      type="number"
                      min={0}
                      step={0.001}
                      value={range.solMin}
                      onChange={(event) =>
                        updateRange(index, "solMin", Number(event.target.value))
                      }
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>solMax</Label>
                    <Input
                      type="number"
                      min={0}
                      step={0.001}
                      value={range.solMax}
                      onChange={(event) =>
                        updateRange(index, "solMax", Number(event.target.value))
                      }
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Increment (optional)</Label>
                    <Input
                      type="number"
                      min={0}
                      step={0.001}
                      value={range.increment ?? ""}
                      onChange={(event) =>
                        updateRange(
                          index,
                          "increment",
                          event.target.value === ""
                            ? null
                            : Number(event.target.value)
                        )
                      }
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Probability (0-1)</Label>
                    <Input
                      type="number"
                      min={0}
                      max={1}
                      step={0.01}
                      value={range.probability}
                      onChange={(event) =>
                        updateRange(
                          index,
                          "probability",
                          Number(event.target.value)
                        )
                      }
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Interval min (sec)</Label>
                    <Input
                      type="number"
                      min={1}
                      value={range.intervalMin}
                      onChange={(event) =>
                        updateRange(
                          index,
                          "intervalMin",
                          Number(event.target.value)
                        )
                      }
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Interval max (sec)</Label>
                    <Input
                      type="number"
                      min={1}
                      value={range.intervalMax}
                      onChange={(event) =>
                        updateRange(
                          index,
                          "intervalMax",
                          Number(event.target.value)
                        )
                      }
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Direction</Label>
                    <Select
                      value={range.direction}
                      onValueChange={(value) => {
                        const nextDirection = value as RangeInput["direction"];
                        updateRange(index, "direction", nextDirection);
                        if (nextDirection === "both" && range.buyProbability === undefined) {
                          updateRange(index, "buyProbability", 0.5);
                        }
                        if (nextDirection !== "both") {
                          updateRange(index, "buyProbability", undefined);
                        }
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="buy">buy</SelectItem>
                        <SelectItem value="sell">sell</SelectItem>
                        <SelectItem value="both">both</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  {range.direction === "both" && (
                    <div className="space-y-2">
                      <Label>Buy probability (0-1)</Label>
                      <Input
                        type="number"
                        min={0}
                        max={1}
                        step={0.01}
                        value={range.buyProbability ?? ""}
                        onChange={(event) =>
                          updateRange(
                            index,
                            "buyProbability",
                            Number(event.target.value)
                          )
                        }
                      />
                    </div>
                  )}
                </div>
              </div>
            ))}
            <div className="text-xs text-muted-foreground">
              Probability sum: {probabilitySum.toFixed(3)} (must be 1.000)
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
                    selectionSummaryQuery.refetch(),
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
                      </div>
                      <div className="text-right text-muted-foreground">
                        <div>{wallet.tokenBalanceUi.toFixed(4)} tokens</div>
                        <div className="text-xs">
                          {wallet.tokenBalanceSol !== null
                            ? `~${wallet.tokenBalanceSol.toFixed(3)} SOL`
                            : "—"}
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
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-primary text-xl">Configuration</CardTitle>
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
                  onChange={(event) =>
                    setGeneratedWalletCount(Number(event.target.value))
                  }
                />
              </div>
              <div className="space-y-2">
                <Label>Funding per generated wallet (SOL)</Label>
                <Input
                  type="number"
                  min={0}
                  step={0.01}
                  value={fundingPerGeneratedWallet}
                  onChange={(event) => {
                    setFundingPerGeneratedWallet(Number(event.target.value));
                    setFundingTouched(true);
                  }}
                />
              </div>
              <div className="space-y-2">
                <Label>Top-up amount for selected wallets (SOL)</Label>
                <Input
                  type="number"
                  min={0}
                  step={0.01}
                  value={topUpAmount}
                  onChange={(event) => setTopUpAmount(Number(event.target.value))}
                />
              </div>
              <div className="space-y-2">
                <Label>Duration (seconds)</Label>
                <Input
                  type="number"
                  min={1}
                  value={targetDurationSeconds}
                  onChange={(event) =>
                    setTargetDurationSeconds(Number(event.target.value))
                  }
                />
              </div>
              <div className="space-y-2">
                <Label>Scheduled start (optional)</Label>
                <Input
                  type="datetime-local"
                  value={scheduledStartAt}
                  onChange={(event) => setScheduledStartAt(event.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>Scheduled stop (optional)</Label>
                <Input
                  type="datetime-local"
                  value={scheduledStopAt}
                  onChange={(event) => setScheduledStopAt(event.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>Slippage (bps)</Label>
                <Input
                  type="number"
                  min={0}
                  value={slippageBps}
                  onChange={(event) => setSlippageBps(Number(event.target.value))}
                />
              </div>
              <div className="space-y-2">
                <Label>Sell fallback ratio (0-1)</Label>
                <Input
                  type="number"
                  min={0}
                  max={1}
                  step={0.01}
                  value={sellFallbackRatio}
                  onChange={(event) =>
                    setSellFallbackRatio(Number(event.target.value))
                  }
                />
              </div>
              <div className="space-y-2">
                <Label>Max slippage failures</Label>
                <Input
                  type="number"
                  min={1}
                  value={maxSlippageFailures}
                  onChange={(event) =>
                    setMaxSlippageFailures(Number(event.target.value))
                  }
                />
              </div>
              <div className="flex items-center gap-2 pt-6">
                <Checkbox
                  checked={pauseOnHighSlippage}
                  onCheckedChange={(checked) =>
                    setPauseOnHighSlippage(Boolean(checked))
                  }
                />
                <Label>Pause wallets on high slippage</Label>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-primary text-xl">Preflight</CardTitle>
          </CardHeader>
          <Separator />
          <CardContent className="space-y-4">
            <div className="grid gap-4 md:grid-cols-3">
              <div>
                <div className="text-xs text-muted-foreground">Total wallets</div>
                <div className="text-lg font-semibold">{totalWallets}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Net direction</div>
                <div className="text-lg font-semibold">{netDirectionLabel}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Duration</div>
                <div className="text-lg font-semibold">
                  {formatDuration(targetDurationSeconds)}
                </div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">
                  Volume per minute
                </div>
                <div className="text-lg font-semibold">
                  {formatNumber(effectivePreflight?.volumePerMinute?.min)}-
                  {formatNumber(effectivePreflight?.volumePerMinute?.max)} SOL
                </div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Total volume</div>
                <div className="text-lg font-semibold">
                  {formatNumber(effectivePreflight?.totalVolume?.min)}-
                  {formatNumber(effectivePreflight?.totalVolume?.max)} SOL
                </div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">
                  Suggested funding
                </div>
                <div className="text-lg font-semibold">
                  {suggestedFunding ? `${suggestedFunding.toFixed(2)} SOL` : "—"}
                </div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">
                  Estimated trades per wallet
                </div>
                <div className="text-lg font-semibold">
                  {formatNumber(effectivePreflight?.estimatedTradesPerWallet)}
                </div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">
                  Avg trade size
                </div>
                <div className="text-lg font-semibold">
                  {formatNumber(effectivePreflight?.avgTradeSizeWeighted)} SOL
                </div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">
                  Net Δ SOL per minute
                </div>
                <div className="text-lg font-semibold">
                  {formatNumber(
                    selectionSummary?.netSolRangePerMinute?.min ??
                      localPreflight?.netSolRangePerMinute?.min
                  )}
                  —
                  {formatNumber(
                    selectionSummary?.netSolRangePerMinute?.max ??
                      localPreflight?.netSolRangePerMinute?.max
                  )}{" "}
                  SOL
                </div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">
                  Total net Δ SOL (at end)
                </div>
                <div className="text-lg font-semibold">
                  {formatNumber(
                    selectionSummary?.netSolRangeTotal?.min ??
                      localPreflight?.netSolRangeTotal?.min
                  )}
                  —
                  {formatNumber(
                    selectionSummary?.netSolRangeTotal?.max ??
                      localPreflight?.netSolRangeTotal?.max
                  )}{" "}
                  SOL
                </div>
              </div>
            </div>
            {fundingBelowSuggested && (
              <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                Funding per generated wallet is below the suggested amount.
              </div>
            )}
            {selectionSummaryQuery.error && (
              <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900">
                Preflight error: {selectionSummaryQuery.error.message}
              </div>
            )}
            {sellWarning && (
              <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                Selected wallets may not have sufficient tokens for configured
                sell volume.
              </div>
            )}
            {ranges.some((r) => r.intervalMin < 5) && (
              <div className="rounded border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-900">
                <strong>High-frequency mode:</strong> Intervals below 5s use
                gRPC streaming. Max{" "}
                {Math.floor(18 * Math.min(...ranges.map((r) => r.intervalMin)))}{" "}
                wallets allowed.
              </div>
            )}
            {netSolDirection < 0 && selectedWalletPublicKeys.length === 0 && (
              <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900">
                Net sell sessions require wallets with token holdings.
              </div>
            )}
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
              Review the configuration before starting.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-3 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Ranges</span>
              <span className="font-semibold">{ranges.length}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Total wallets</span>
              <span className="font-semibold">{totalWallets}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Duration</span>
              <span className="font-semibold">
                {formatDuration(targetDurationSeconds)}
              </span>
            </div>
            {scheduledStartAt && (
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Scheduled start</span>
                <span className="font-semibold">{scheduledStartAt}</span>
              </div>
            )}
            {scheduledStopAt && (
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Scheduled stop</span>
                <span className="font-semibold">{scheduledStopAt}</span>
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
