"use client";

import Link from "next/link";
import { useRouter, useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc/client";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";
import { Label } from "@/components/ui/label";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { TokenNotFound } from "@/components/placeholders/token-not-found";
import { DashboardLoading } from "../../dashboard/dashboard-loading";
import { Separator } from "@/components/ui/separator";
import { Checkbox } from "@/components/ui/checkbox";
import { Spinner } from "@/components/ui/spinner";
import {
  PageHeader,
  PageSection,
  PageSectionDivider,
  PageSectionHeader,
} from "@/components/layout/sections";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  CalendarIcon,
  CopyIcon,
  AlertTriangleIcon,
  FolderOpenIcon,
  InfoIcon,
  LayersIcon,
  OctagonAlertIcon,
  PencilIcon,
  PlusIcon,
  RefreshCwIcon,
  SaveIcon,
  Trash2Icon,
  WalletIcon,
} from "lucide-react";
import { format, setHours, setMinutes } from "date-fns";
import { Switch } from "@/components/ui/switch";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { VolumeBotConfigInput } from "@/server/schemas/volume-bot.schema";
import { calculateVolumeBotUsageFees } from "@/lib/config/usage-fees.config";
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
  intervalMin: number;
  intervalMax: number;
  direction: "buy" | "sell" | "both";
  buyProbability?: number;
};

const defaultRange: RangeInput = {
  solMin: 0.01,
  solMax: 0.03,
  increment: 0.01,
  intervalMin: 10,
  intervalMax: 30,
  direction: "both",
  buyProbability: 0.5,
};

const formatDuration = (seconds: number) => {
  if (!Number.isFinite(seconds) || seconds <= 0) return "—";
  if (seconds < 300) return `${Math.floor(seconds)}s`;
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

const isRangeInputValid = (range: RangeInput) => {
  if (
    !Number.isFinite(range.solMin) ||
    !Number.isFinite(range.solMax) ||
    !Number.isFinite(range.intervalMin) ||
    !Number.isFinite(range.intervalMax)
  ) {
    return false;
  }
  if (
    range.solMin < 0.001 ||
    range.solMax > 10 ||
    range.solMin > range.solMax
  ) {
    return false;
  }
  if (
    range.intervalMin < 1 ||
    range.intervalMax < 1 ||
    range.intervalMax > 3600 ||
    range.intervalMin > range.intervalMax
  ) {
    return false;
  }
  if (range.direction === "both") {
    const buyProbability = range.buyProbability;
    if (
      !Number.isFinite(buyProbability ?? Number.NaN) ||
      (buyProbability ?? 0) < 0 ||
      (buyProbability ?? 0) > 1
    ) {
      return false;
    }
  }
  if (range.increment !== null && range.increment !== undefined) {
    if (!Number.isFinite(range.increment) || range.increment <= 0) {
      return false;
    }
    const steps =
      Math.floor((range.solMax - range.solMin) / range.increment + 1e-9) + 1;
    if (steps < 2) {
      return false;
    }
  }
  return true;
};

const getRangeValidationErrors = (range: RangeInput) => {
  const errors: string[] = [];
  if (!Number.isFinite(range.solMin) || !Number.isFinite(range.solMax)) {
    errors.push("SOL min/max must be valid numbers.");
  } else {
    if (range.solMin < 0.001) errors.push("SOL min must be at least 0.001.");
    if (range.solMax > 10) errors.push("SOL max must be at most 10.");
    if (range.solMin > range.solMax)
      errors.push("SOL min cannot exceed SOL max.");
  }

  if (
    !Number.isFinite(range.intervalMin) ||
    !Number.isFinite(range.intervalMax)
  ) {
    errors.push("Interval min/max must be valid numbers.");
  } else {
    if (range.intervalMin < 1)
      errors.push("Interval min must be at least 1 second.");
    if (range.intervalMax > 3600)
      errors.push("Interval max must be at most 3600 seconds.");
    if (range.intervalMin > range.intervalMax)
      errors.push("Interval min cannot exceed interval max.");
  }

  if (range.direction === "both") {
    const buyProbability = range.buyProbability;
    if (!Number.isFinite(buyProbability ?? Number.NaN)) {
      errors.push("Buy probability is required for both direction.");
    } else if ((buyProbability ?? 0) < 0 || (buyProbability ?? 0) > 1) {
      errors.push("Buy probability must be between 0 and 1.");
    }
  }

  if (range.increment !== null && range.increment !== undefined) {
    if (!Number.isFinite(range.increment) || range.increment <= 0) {
      errors.push("Increment must be greater than 0.");
    } else {
      const steps =
        Math.floor((range.solMax - range.solMin) / range.increment + 1e-9) + 1;
      if (steps < 2) {
        errors.push("Increment must produce at least 2 steps.");
      }
    }
  }
  return errors;
};

const formatPresetSummary = (config: VolumeBotConfigInput) => {
  const rangeCount = config.ranges.length;
  const directions = new Set(config.ranges.map((r) => r.direction));
  const dirLabel = directions.size === 1 ? [...directions][0] : "mixed";
  const totalWallets =
    config.walletConfig.generatedWalletCount +
    config.walletConfig.selectedWalletPublicKeys.length;
  return `${rangeCount} range${rangeCount !== 1 ? "s" : ""} · ${dirLabel} · ${totalWallets} wallet${totalWallets !== 1 ? "s" : ""} · ${formatDuration(config.targetDurationSeconds)}`;
};

const formatRangeSummary = (range: RangeInput) => {
  const directionLabel =
    range.direction === "both"
      ? `both (${((range.buyProbability ?? 0) * 100).toFixed(0)}% buy)`
      : range.direction;
  return `${range.solMin.toFixed(3)}-${range.solMax.toFixed(3)} SOL • every ${
    range.intervalMin
  }-${range.intervalMax}s • ${directionLabel}`;
};

export default function VolumeBotStartPage() {
  const { tokenPublicKey } = useParams<{ tokenPublicKey: string }>();
  const router = useRouter();
  const utils = trpc.useUtils();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [walletDialogOpen, setWalletDialogOpen] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [durationUnit, setDurationUnit] = useState<"sec" | "min" | "hr">("sec");
  const [isRefreshingWallets, setIsRefreshingWallets] = useState(false);
  const [ranges, setRanges] = useState<RangeInput[]>([defaultRange]);

  const [generatedWalletCount, setGeneratedWalletCount] = useState(10);
  const [selectedWalletPublicKeys, setSelectedWalletPublicKeys] = useState<
    string[]
  >([]);
  const [fundingPerGeneratedWallet, setFundingPerGeneratedWallet] =
    useState(0.5);
  const [topUpAmount, setTopUpAmount] = useState(0.01);
  const [slippageBps, setSlippageBps] = useState(1000);
  const [sellFallbackRatio, setSellFallbackRatio] = useState(0.5);
  const [pauseOnHighSlippage, setPauseOnHighSlippage] = useState(true);
  const [maxSlippageFailures, setMaxSlippageFailures] = useState(3);
  const [targetDurationSeconds, setTargetDurationSeconds] = useState(
    DEFAULT_DURATION_SECONDS
  );
  const [scheduledStartEnabled, setScheduledStartEnabled] = useState(false);
  const [scheduledStartDate, setScheduledStartDate] = useState<
    Date | undefined
  >(undefined);
  const [scheduledStopAt, setScheduledStopAt] = useState("");
  const [fundingTouched, setFundingTouched] = useState(false);
  const [presetName, setPresetName] = useState("");
  const [selectedPresetId, setSelectedPresetId] = useState<string | null>(null);
  const [presetsDialogOpen, setPresetsDialogOpen] = useState(false);
  const [createPresetDialogOpen, setCreatePresetDialogOpen] = useState(false);
  const [createPresetMode, setCreatePresetMode] = useState<
    "new" | "overwrite" | null
  >(null);
  const [newPresetName, setNewPresetName] = useState("");
  const [pendingLoadPresetId, setPendingLoadPresetId] = useState<string | null>(
    null
  );
  const [editingPresetId, setEditingPresetId] = useState<string | null>(null);
  const [editingPresetName, setEditingPresetName] = useState("");

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

  const presetsQuery = trpc.volumeBot.listPresets.useQuery(
    {},
    { retry: false }
  );

  const savePresetMutation = trpc.volumeBot.savePreset.useMutation({
    onSuccess: (preset) => {
      toast.success("Preset saved");
      presetsQuery.refetch();
      setSelectedPresetId(preset.id);
      setPresetName(preset.name);
      setCreatePresetDialogOpen(false);
      setCreatePresetMode(null);
      setNewPresetName("");
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
  const isConfigValid = useMemo(() => {
    return ranges.every((range) => isRangeInputValid(range));
  }, [ranges]);
  const selectedPreset = useMemo(() => {
    return presetsQuery.data?.find((preset) => preset.id === selectedPresetId);
  }, [presetsQuery.data, selectedPresetId]);

  const hasUnsavedChanges = useMemo(() => {
    if (!selectedPreset) {
      const isDefault =
        ranges.length === 1 &&
        JSON.stringify(ranges[0]) === JSON.stringify(defaultRange) &&
        targetDurationSeconds === DEFAULT_DURATION_SECONDS &&
        generatedWalletCount === 10 &&
        fundingPerGeneratedWallet === 0.5 &&
        topUpAmount === 0.01 &&
        slippageBps === 1000 &&
        sellFallbackRatio === 0.5 &&
        pauseOnHighSlippage === true &&
        maxSlippageFailures === 3;
      return !isDefault;
    }
    const presetConfig = selectedPreset.config as VolumeBotConfigInput;
    if (!presetConfig) return true;
    const currentWithoutWalletSelection = {
      ranges: ranges.map((r) => ({
        ...r,
        increment: r.increment !== null && r.increment > 0 ? r.increment : null,
        buyProbability: r.direction === "both" ? r.buyProbability : undefined,
      })),
      walletConfig: {
        generatedWalletCount,
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
    };
    const presetWithoutWalletSelection = {
      ranges: presetConfig.ranges,
      walletConfig: {
        generatedWalletCount: presetConfig.walletConfig.generatedWalletCount,
        fundingPerGeneratedWallet:
          presetConfig.walletConfig.fundingPerGeneratedWallet,
        topUpAmount: presetConfig.walletConfig.topUpAmount,
      },
      behaviorConfig: presetConfig.behaviorConfig,
      targetDurationSeconds: presetConfig.targetDurationSeconds,
    };
    return (
      JSON.stringify(currentWithoutWalletSelection) !==
      JSON.stringify(presetWithoutWalletSelection)
    );
  }, [
    selectedPreset,
    ranges,
    generatedWalletCount,
    fundingPerGeneratedWallet,
    topUpAmount,
    slippageBps,
    sellFallbackRatio,
    pauseOnHighSlippage,
    maxSlippageFailures,
    targetDurationSeconds,
  ]);

  const configInput = useMemo(
    () => ({
      ranges: ranges.map((range) => ({
        ...range,
        increment:
          range.increment !== null && range.increment > 0
            ? range.increment
            : null,
        buyProbability:
          range.direction === "both" ? range.buyProbability : undefined,
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

  const selectionSummaryEnabled =
    Boolean(tokenPublicKey && tokenData) &&
    ranges.length > 0 &&
    totalWallets > 0 &&
    targetDurationSeconds > 0 &&
    isConfigValid;
  const selectionSummaryQuery = trpc.volumeBot.selectionSummary.useQuery(
    {
      tokenPublicKey: tokenPublicKey || "",
      config: configInput,
    },
    {
      enabled: selectionSummaryEnabled,
      retry: false,
    }
  );

  const startMutation = trpc.volumeBot.start.useMutation({
    onError: (startError) => {
      toast.error(startError.message || "Failed to start volume bot");
    },
  });
  const refreshWalletBalancesMutation =
    trpc.wallet.refreshBalances.useMutation();

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
  const selectedTokenSolValue = useMemo(() => {
    if (selectedWalletPublicKeys.length === 0) return 0;
    return eligibleWallets
      .filter((wallet) => selectedWalletPublicKeys.includes(wallet.publicKey))
      .reduce((sum, wallet) => sum + (wallet.tokenBalanceSol ?? 0), 0);
  }, [eligibleWallets, selectedWalletPublicKeys]);
  const copyToClipboard = useCallback((text: string) => {
    navigator.clipboard.writeText(text);
    toast.success("Copied to clipboard");
  }, []);
  const visibleWallets = useMemo(() => {
    return [...eligibleWallets].sort(
      (a, b) => b.tokenBalanceUi - a.tokenBalanceUi
    );
  }, [eligibleWallets]);

  const totalFunding = useMemo(
    () => generatedWalletCount * fundingPerGeneratedWallet,
    [generatedWalletCount, fundingPerGeneratedWallet]
  );
  const totalTopUp = useMemo(
    () => selectedWalletPublicKeys.length * topUpAmount,
    [selectedWalletPublicKeys.length, topUpAmount]
  );
  const localUsageFees = useMemo(
    () => calculateVolumeBotUsageFees(generatedWalletCount),
    [generatedWalletCount]
  );

  const localPreflight = useMemo(() => {
    if (
      ranges.length === 0 ||
      totalWallets <= 0 ||
      targetDurationSeconds <= 0 ||
      !isConfigValid
    ) {
      return null;
    }
    let netSolDirection = 0;
    let estimatedTradesPerWallet = 0;
    let totalVolumePerWallet = 0;
    let minVolumePerMinute = 0;
    let maxVolumePerMinute = 0;
    let minNetSolPerMinute = 0;
    let maxNetSolPerMinute = 0;
    for (const range of ranges) {
      const avgAmount = (range.solMin + range.solMax) / 2;
      const avgInterval = (range.intervalMin + range.intervalMax) / 2;
      if (avgInterval > 0) {
        const tradesFromRange = targetDurationSeconds / avgInterval;
        estimatedTradesPerWallet += tradesFromRange;
        totalVolumePerWallet += tradesFromRange * avgAmount;
      }
      const tradesPerMinute =
        avgInterval > 0 ? (60 / avgInterval) * totalWallets : 0;
      if (range.direction === "buy") {
        netSolDirection += avgAmount;
        minNetSolPerMinute += range.solMin * tradesPerMinute;
        maxNetSolPerMinute += range.solMax * tradesPerMinute;
      } else if (range.direction === "sell") {
        netSolDirection -= avgAmount;
        minNetSolPerMinute -= range.solMax * tradesPerMinute;
        maxNetSolPerMinute -= range.solMin * tradesPerMinute;
      } else {
        const buyProbability = range.buyProbability ?? 0;
        const sellProbability = 1 - buyProbability;
        netSolDirection += avgAmount * (2 * buyProbability - 1);
        minNetSolPerMinute +=
          (buyProbability * range.solMin - sellProbability * range.solMax) *
          tradesPerMinute;
        maxNetSolPerMinute +=
          (buyProbability * range.solMax - sellProbability * range.solMin) *
          tradesPerMinute;
      }
      minVolumePerMinute +=
        ((range.solMin * 60) / range.intervalMax) * totalWallets;
      maxVolumePerMinute +=
        ((range.solMax * 60) / range.intervalMin) * totalWallets;
    }
    const avgIntervalWeighted =
      estimatedTradesPerWallet > 0
        ? targetDurationSeconds / estimatedTradesPerWallet
        : 0;
    const avgTradeSizeWeighted =
      estimatedTradesPerWallet > 0
        ? totalVolumePerWallet / estimatedTradesPerWallet
        : 0;
    const totalExpectedVolume = totalVolumePerWallet * totalWallets;
    const bufferMultiplier =
      netSolDirection > 0 && totalExpectedVolume > 0
        ? clampNumber(1 + netSolDirection / totalExpectedVolume, 1, 2)
        : 1;
    const baseFunding = totalVolumePerWallet;
    const suggestedFunding =
      Math.ceil(baseFunding * bufferMultiplier * 1.1 * 100) / 100;
    const minutes = targetDurationSeconds / 60;
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
        min: minNetSolPerMinute,
        max: maxNetSolPerMinute,
      },
      netSolRangeTotal: {
        min: minNetSolPerMinute * minutes,
        max: maxNetSolPerMinute * minutes,
      },
    };
  }, [isConfigValid, ranges, targetDurationSeconds, totalWallets]);

  const selectionSummary = selectionSummaryQuery.data;
  const effectivePreflight = selectionSummary ?? localPreflight;
  const usageFees = selectionSummary?.usageFees ?? localUsageFees;
  const estimatedTotalOutflowSol =
    selectionSummary?.estimatedTotalOutflowSol ??
    usageFees.totalFeeSol + totalFunding + totalTopUp;
  const netSolDirection = effectivePreflight?.netSolDirection ?? 0;
  const netDirectionLabel =
    netSolDirection > 0
      ? "Net buy"
      : netSolDirection < 0
        ? "Net sell"
        : "Neutral";
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
    setRanges((current) => [...current, { ...defaultRange }]);
  };

  const removeRange = (index: number) => {
    setRanges((current) =>
      current.filter((_, rangeIndex) => rangeIndex !== index)
    );
  };

  const duplicateRange = (index: number) => {
    if (ranges.length >= 5) {
      toast.error("Max 5 ranges allowed");
      return;
    }
    setRanges((current) => {
      const next = [...current];
      const source = next[index];
      if (!source) {
        return current;
      }
      next.splice(index + 1, 0, { ...source });
      return next;
    });
  };

  const toggleWallet = (walletPublicKey: string) => {
    setSelectedWalletPublicKeys((current) => {
      if (current.includes(walletPublicKey)) {
        return current.filter((key) => key !== walletPublicKey);
      }
      return [...current, walletPublicKey];
    });
  };

  const handleApplyPreset = (presetId?: string) => {
    const targetPreset = presetId
      ? presetsQuery.data?.find((p) => p.id === presetId)
      : selectedPreset;
    if (!targetPreset) {
      toast.error("Select a preset to apply");
      return;
    }
    const presetConfig = targetPreset.config as VolumeBotConfigInput;
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
            ? (range.buyProbability ?? 0.5)
            : undefined,
      }))
    );
    setGeneratedWalletCount(presetConfig.walletConfig.generatedWalletCount);
    setSelectedWalletPublicKeys(
      presetConfig.walletConfig.selectedWalletPublicKeys
    );
    setFundingPerGeneratedWallet(
      presetConfig.walletConfig.fundingPerGeneratedWallet
    );
    setTopUpAmount(presetConfig.walletConfig.topUpAmount);
    setSlippageBps(presetConfig.behaviorConfig.slippageBps);
    setSellFallbackRatio(presetConfig.behaviorConfig.sellFallbackRatio);
    setPauseOnHighSlippage(presetConfig.behaviorConfig.pauseOnHighSlippage);
    setMaxSlippageFailures(presetConfig.behaviorConfig.maxSlippageFailures);
    setTargetDurationSeconds(presetConfig.targetDurationSeconds);
    setFundingTouched(true);
    setSelectedPresetId(targetPreset.id);
    setPresetName(targetPreset.name);
  };

  const handleSavePreset = async (nameOverride?: string) => {
    const trimmedName = (nameOverride ?? presetName).trim();
    if (!trimmedName) {
      toast.error("Preset name required");
      return;
    }
    await savePresetMutation.mutateAsync({
      name: trimmedName,
      config: configInput,
    });
  };

  const handleRenamePreset = async (presetId: string, newName: string) => {
    const preset = presetsQuery.data?.find((p) => p.id === presetId);
    if (!preset) return;
    const trimmed = newName.trim();
    if (!trimmed || trimmed === preset.name) {
      setEditingPresetId(null);
      return;
    }
    await savePresetMutation.mutateAsync({
      name: trimmed,
      config: preset.config as VolumeBotConfigInput,
    });
    setEditingPresetId(null);
  };

  const requestLoadPreset = (presetId: string) => {
    if (hasUnsavedChanges) {
      setPendingLoadPresetId(presetId);
    } else {
      handleApplyPreset(presetId);
      setPresetsDialogOpen(false);
    }
  };

  const confirmLoadPreset = () => {
    if (pendingLoadPresetId) {
      handleApplyPreset(pendingLoadPresetId);
      setPendingLoadPresetId(null);
      setPresetsDialogOpen(false);
    }
  };

  const handleOpenCreatePreset = () => {
    if (selectedPresetId) {
      setCreatePresetMode(null);
      setNewPresetName("");
    } else {
      setCreatePresetMode("new");
      setNewPresetName("");
    }
    setCreatePresetDialogOpen(true);
  };

  const handleDeletePreset = async (presetId: string) => {
    await deletePresetMutation.mutateAsync({ presetId });
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
        (range.buyProbability === undefined ||
          Number.isNaN(range.buyProbability))
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
    const scheduledStop = parseDateTime(scheduledStopAt);
    const result = await startMutation.mutateAsync({
      tokenPublicKey: tokenPublicKey || "",
      config: configInput,
      scheduledStartAt:
        scheduledStartEnabled && scheduledStartDate
          ? scheduledStartDate
          : undefined,
      scheduledStopAt: scheduledStop,
    });
    toast.success("Volume bot started");
    setConfirmOpen(false);
    await refreshWalletBalancesMutation.mutateAsync({
      tokenPublicKey: tokenPublicKey || "",
      force: true,
    });
    utils.wallet.getMain.invalidate();
    router.push(`/${tokenPublicKey}/volume-bot/${result.sessionId}`);
  };

  if (isLoading) {
    return <DashboardLoading />;
  }

  if (!tokenData) {
    return <TokenNotFound error={error} onRetry={() => refetch()} />;
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="New Volume Bot"
        rightContent={
          <div className="flex flex-col items-end">
            <Button
              type="button"
              variant="outline"
              size="lg"
              onClick={() => setPresetsDialogOpen(true)}
              disabled={!presetsQuery.data?.length}
            >
              <FolderOpenIcon className="size-3.5 mr-1.5" />
              Presets
              {selectedPreset ? (
                <span className="ml-1 text-muted-foreground">
                  · {selectedPreset.name}
                </span>
              ) : (presetsQuery.data?.length ?? 0) > 0 ? (
                <span className="ml-1 text-muted-foreground">
                  · {presetsQuery.data!.length} saved
                </span>
              ) : null}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="lg"
              className="translate-y-2"
              onClick={handleOpenCreatePreset}
            >
              <SaveIcon className="size-3.5 mr-1.5" />
              Save preset
            </Button>
          </div>
        }
      />

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
              <Link href={`/${tokenPublicKey}/volume-bot/${session.id}`}>
                View run
              </Link>
            </Button>
          </CardContent>
        </Card>
      )}

      <section className="pb-8">
        <div className="space-y-5">
          <PageSectionHeader
            title="Ranges"
            meta={
              <span className="text-sm text-muted-foreground">
                {ranges.length} / 5
              </span>
            }
          />

          {ranges.map((range, index) => {
            const errors = getRangeValidationErrors(range);
            const hasErrors = errors.length > 0;
            return (
              <div
                key={index}
                className={cn(
                  "rounded-lg border border-l-4 bg-card transition-colors",
                  range.direction === "buy" && "border-l-green-500",
                  range.direction === "sell" && "border-l-red-500",
                  range.direction === "both" && "border-l-muted-foreground/40",
                  hasErrors && "border-red-300 border-l-red-400"
                )}
              >
                <div className="flex items-center justify-between gap-4 px-5 pt-4 pb-2">
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="text-sm font-semibold shrink-0">
                      Range {index + 1}
                    </span>
                    <span className="text-xs text-muted-foreground truncate">
                      {formatRangeSummary(range)}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="size-8 text-muted-foreground hover:text-foreground"
                          onClick={() => duplicateRange(index)}
                          disabled={ranges.length >= 5}
                        >
                          <CopyIcon className="size-4" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Duplicate range</TooltipContent>
                    </Tooltip>
                    {ranges.length > 1 && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="size-8 text-muted-foreground hover:text-destructive"
                            onClick={() => removeRange(index)}
                          >
                            <Trash2Icon className="size-4" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Remove range</TooltipContent>
                      </Tooltip>
                    )}
                  </div>
                </div>

                <div className="px-5 pb-5 space-y-5">
                  <div className="flex flex-wrap items-end gap-4">
                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground">
                        Direction
                      </Label>
                      <ToggleGroup
                        type="single"
                        variant="outline"
                        value={range.direction}
                        onValueChange={(value) => {
                          if (!value) return;
                          const nextDirection =
                            value as RangeInput["direction"];
                          updateRange(index, "direction", nextDirection);
                          if (
                            nextDirection === "both" &&
                            range.buyProbability === undefined
                          ) {
                            updateRange(index, "buyProbability", 0.5);
                          }
                          if (nextDirection !== "both") {
                            updateRange(index, "buyProbability", undefined);
                          }
                        }}
                      >
                        <ToggleGroupItem
                          value="buy"
                          className="data-[state=on]:bg-green-500/10 data-[state=on]:text-green-400 data-[state=on]:border-green-500/30 px-3"
                        >
                          Buy
                        </ToggleGroupItem>
                        <ToggleGroupItem
                          value="sell"
                          className="data-[state=on]:bg-red-500/10 data-[state=on]:text-red-400 data-[state=on]:border-red-500/30 px-3"
                        >
                          Sell
                        </ToggleGroupItem>
                        <ToggleGroupItem
                          value="both"
                          className="data-[state=on]:bg-muted data-[state=on]:text-muted-foreground data-[state=on]:border-border px-3"
                        >
                          Both
                        </ToggleGroupItem>
                      </ToggleGroup>
                    </div>

                    {range.direction === "both" && (
                      <div className="space-y-1.5">
                        <Label className="text-xs text-muted-foreground">
                          Buy probability
                        </Label>
                        <InputGroup className="w-28">
                          <InputGroupInput
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
                          <InputGroupAddon align="inline-end">
                            %
                          </InputGroupAddon>
                        </InputGroup>
                      </div>
                    )}
                  </div>

                  <div className="grid gap-x-8 gap-y-5 md:grid-cols-2">
                    <div className="space-y-2">
                      <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                        Trade Size
                      </span>
                      <div className="grid grid-cols-3 gap-2">
                        <div className="space-y-1">
                          <Label className="text-xs text-muted-foreground">
                            Min
                          </Label>
                          <InputGroup>
                            <InputGroupInput
                              type="number"
                              min={0}
                              step={0.001}
                              value={range.solMin}
                              onChange={(event) =>
                                updateRange(
                                  index,
                                  "solMin",
                                  Number(event.target.value)
                                )
                              }
                            />
                            <InputGroupAddon align="inline-end">
                              SOL
                            </InputGroupAddon>
                          </InputGroup>
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs text-muted-foreground">
                            Max
                          </Label>
                          <InputGroup>
                            <InputGroupInput
                              type="number"
                              min={0}
                              step={0.001}
                              value={range.solMax}
                              onChange={(event) =>
                                updateRange(
                                  index,
                                  "solMax",
                                  Number(event.target.value)
                                )
                              }
                            />
                            <InputGroupAddon align="inline-end">
                              SOL
                            </InputGroupAddon>
                          </InputGroup>
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs text-muted-foreground">
                            Step
                          </Label>
                          <InputGroup>
                            <InputGroupInput
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
                              placeholder="—"
                            />
                            <InputGroupAddon align="inline-end">
                              SOL
                            </InputGroupAddon>
                          </InputGroup>
                        </div>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                        Frequency
                      </span>
                      <div className="grid grid-cols-2 gap-2">
                        <div className="space-y-1">
                          <Label className="text-xs text-muted-foreground">
                            Min
                          </Label>
                          <InputGroup>
                            <InputGroupInput
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
                            <InputGroupAddon align="inline-end">
                              sec
                            </InputGroupAddon>
                          </InputGroup>
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs text-muted-foreground">
                            Max
                          </Label>
                          <InputGroup>
                            <InputGroupInput
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
                            <InputGroupAddon align="inline-end">
                              sec
                            </InputGroupAddon>
                          </InputGroup>
                        </div>
                      </div>
                    </div>
                  </div>

                  {hasErrors && (
                    <div className="text-xs text-red-600 space-y-0.5">
                      {errors.map((message) => (
                        <div key={message}>{message}</div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            );
          })}

          {ranges.length < 5 && (
            <button
              type="button"
              onClick={addRange}
              className="w-full rounded-lg border-2 border-dashed border-muted-foreground/25 py-3 text-sm text-muted-foreground hover:border-primary/50 hover:text-foreground transition-colors"
            >
              + Add range
            </button>
          )}
        </div>

        <PageSectionDivider />

        <PageSection>
          <PageSectionHeader title="Configuration" />

          <div className="grid gap-x-8 gap-y-5 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Duration</Label>
              <div className="flex gap-2">
                <InputGroup className="flex-1">
                  <InputGroupInput
                    type="number"
                    min={1}
                    value={
                      durationUnit === "sec"
                        ? targetDurationSeconds
                        : durationUnit === "min"
                          ? Math.round(targetDurationSeconds / 60)
                          : Math.round(targetDurationSeconds / 3600)
                    }
                    onChange={(event) => {
                      const raw = Number(event.target.value);
                      const multiplier =
                        durationUnit === "hr"
                          ? 3600
                          : durationUnit === "min"
                            ? 60
                            : 1;
                      setTargetDurationSeconds(Math.max(1, raw * multiplier));
                    }}
                  />
                </InputGroup>
                <ToggleGroup
                  type="single"
                  variant="outline"
                  value={durationUnit}
                  onValueChange={(value) => {
                    if (!value) return;
                    setDurationUnit(value as "sec" | "min" | "hr");
                  }}
                >
                  <ToggleGroupItem value="sec" className="px-2.5">
                    sec
                  </ToggleGroupItem>
                  <ToggleGroupItem value="min" className="px-2.5">
                    min
                  </ToggleGroupItem>
                  <ToggleGroupItem value="hr" className="px-2.5">
                    hr
                  </ToggleGroupItem>
                </ToggleGroup>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">
                Scheduled start
              </Label>
              <div className="flex items-center gap-3 h-8">
                <Switch
                  checked={scheduledStartEnabled}
                  onCheckedChange={(checked) => {
                    setScheduledStartEnabled(checked);
                    if (checked && !scheduledStartDate) {
                      const now = new Date();
                      now.setMinutes(now.getMinutes() + 30);
                      now.setSeconds(0, 0);
                      setScheduledStartDate(now);
                    }
                  }}
                />
                {scheduledStartEnabled && (
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        className={cn(
                          "w-[220px] justify-start text-left font-normal h-8",
                          !scheduledStartDate && "text-muted-foreground"
                        )}
                      >
                        <CalendarIcon className="size-3.5 text-muted-foreground" />
                        {scheduledStartDate ? (
                          format(scheduledStartDate, "MMM d, yyyy  HH:mm")
                        ) : (
                          <span>Pick date & time</span>
                        )}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent
                      className="w-auto p-0"
                      align="start"
                      sideOffset={8}
                    >
                      <Calendar
                        mode="single"
                        selected={scheduledStartDate}
                        onSelect={(day) => {
                          if (!day) return;
                          const prev = scheduledStartDate ?? new Date();
                          const updated = setMinutes(
                            setHours(day, prev.getHours()),
                            prev.getMinutes()
                          );
                          setScheduledStartDate(updated);
                        }}
                        disabled={{ before: new Date() }}
                        initialFocus
                      />
                      <Separator />
                      <div className="flex items-center justify-center gap-2 px-4 py-3">
                        <Label className="text-xs text-muted-foreground">
                          Time
                        </Label>
                        <Input
                          type="number"
                          min={0}
                          max={23}
                          className="w-16 h-8 text-center"
                          value={
                            scheduledStartDate
                              ? String(scheduledStartDate.getHours()).padStart(
                                  2,
                                  "0"
                                )
                              : "00"
                          }
                          onChange={(e) => {
                            const h = Math.min(
                              23,
                              Math.max(0, Number(e.target.value))
                            );
                            setScheduledStartDate((prev) =>
                              prev ? setHours(prev, h) : setHours(new Date(), h)
                            );
                          }}
                        />
                        <span className="text-muted-foreground font-medium">
                          :
                        </span>
                        <Input
                          type="number"
                          min={0}
                          max={59}
                          className="w-16 h-8 text-center"
                          value={
                            scheduledStartDate
                              ? String(
                                  scheduledStartDate.getMinutes()
                                ).padStart(2, "0")
                              : "00"
                          }
                          onChange={(e) => {
                            const m = Math.min(
                              59,
                              Math.max(0, Number(e.target.value))
                            );
                            setScheduledStartDate((prev) =>
                              prev
                                ? setMinutes(prev, m)
                                : setMinutes(new Date(), m)
                            );
                          }}
                        />
                      </div>
                    </PopoverContent>
                  </Popover>
                )}
              </div>
            </div>
          </div>

          <div>
            <button
              type="button"
              onClick={() => setAdvancedOpen((current) => !current)}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              {advancedOpen ? "Hide" : "Show"} advanced options
            </button>

            {advancedOpen && (
              <div className="mt-4 grid gap-x-8 gap-y-5 md:grid-cols-3">
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">
                    Slippage
                  </Label>
                  <InputGroup>
                    <InputGroupInput
                      type="number"
                      min={0}
                      value={slippageBps}
                      onChange={(event) =>
                        setSlippageBps(Number(event.target.value))
                      }
                    />
                    <InputGroupAddon align="inline-end">bps</InputGroupAddon>
                  </InputGroup>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">
                    Sell fallback ratio
                  </Label>
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
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">
                    Max slippage failures
                  </Label>
                  <Input
                    type="number"
                    min={1}
                    value={maxSlippageFailures}
                    onChange={(event) =>
                      setMaxSlippageFailures(Number(event.target.value))
                    }
                  />
                </div>
                <div className="flex items-center gap-2 pt-2">
                  <Checkbox
                    checked={pauseOnHighSlippage}
                    onCheckedChange={(checked) =>
                      setPauseOnHighSlippage(Boolean(checked))
                    }
                  />
                  <Label className="text-xs text-muted-foreground">
                    Pause wallets on high slippage
                  </Label>
                </div>
              </div>
            )}
          </div>
        </PageSection>

        <PageSectionDivider />

        <PageSection>
          <PageSectionHeader title="Wallets" />

          <div className="grid gap-x-8 gap-y-5 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">
                Generate new wallets
              </Label>
              <Input
                type="number"
                min={0}
                value={generatedWalletCount}
                onChange={(event) =>
                  setGeneratedWalletCount(Number(event.target.value))
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">
                Funding per generated wallet
              </Label>
              <InputGroup>
                <InputGroupInput
                  type="number"
                  min={0}
                  step={0.01}
                  value={fundingPerGeneratedWallet}
                  onChange={(event) => {
                    setFundingPerGeneratedWallet(Number(event.target.value));
                    setFundingTouched(true);
                  }}
                />
                <InputGroupAddon align="inline-end">SOL</InputGroupAddon>
              </InputGroup>
              {generatedWalletCount > 0 && (
                <div className="text-xs text-muted-foreground tabular-nums">
                  {generatedWalletCount} × {fundingPerGeneratedWallet} ={" "}
                  <span className="text-foreground font-medium">
                    {totalFunding.toFixed(2)} SOL
                  </span>
                </div>
              )}
            </div>
          </div>

          <div className="grid gap-x-8 gap-y-5 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">
                Select existing wallets
              </Label>
              <Button
                type="button"
                variant="outline"
                className="w-full justify-start gap-2"
                onClick={() => setWalletDialogOpen(true)}
              >
                <WalletIcon className="size-4 text-primary" />
                {selectedWalletPublicKeys.length > 0
                  ? `${selectedWalletPublicKeys.length} wallet${
                      selectedWalletPublicKeys.length !== 1 ? "s" : ""
                    } selected`
                  : "Select wallets"}
              </Button>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">
                Top-up per selected wallet
              </Label>
              <InputGroup>
                <InputGroupInput
                  type="number"
                  min={0}
                  step={0.01}
                  value={topUpAmount}
                  onChange={(event) =>
                    setTopUpAmount(Number(event.target.value))
                  }
                />
                <InputGroupAddon align="inline-end">SOL</InputGroupAddon>
              </InputGroup>
              {selectedWalletPublicKeys.length > 0 && topUpAmount > 0 && (
                <div className="text-xs text-muted-foreground tabular-nums">
                  {selectedWalletPublicKeys.length} × {topUpAmount} ={" "}
                  <span className="text-foreground font-medium">
                    {totalTopUp.toFixed(2)} SOL
                  </span>{" "}
                  max
                </div>
              )}
            </div>
          </div>
        </PageSection>

        <Dialog open={walletDialogOpen} onOpenChange={setWalletDialogOpen}>
          <DialogContent className="sm:max-w-3xl max-h-[85vh] flex flex-col gap-0 p-0">
            <div className="flex items-center justify-between px-6 pt-6 pb-4">
              <DialogHeader className="space-y-0">
                <DialogTitle>Select wallets</DialogTitle>
              </DialogHeader>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
                disabled={
                  isRefreshingWallets || eligibleWalletsQuery.isFetching
                }
                onClick={async () => {
                  setIsRefreshingWallets(true);
                  try {
                    await Promise.all([
                      eligibleWalletsQuery.refetch(),
                      selectionSummaryEnabled
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
                    <Spinner className="mr-1 size-3" />
                    Refreshing
                  </>
                ) : (
                  "Refresh"
                )}
              </Button>
            </div>

            <div className="flex items-center justify-between px-6 pb-3">
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                  onClick={() =>
                    setSelectedWalletPublicKeys(
                      visibleWallets.map((w) => w.publicKey)
                    )
                  }
                >
                  Select all
                </button>
                <button
                  type="button"
                  className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                  onClick={() => setSelectedWalletPublicKeys([])}
                >
                  Clear
                </button>
              </div>
              <div className="text-xs text-muted-foreground tabular-nums">
                {selectedWalletPublicKeys.length} of {visibleWallets.length}{" "}
                selected
              </div>
            </div>

            <Separator />

            <div className="flex-1 overflow-y-auto px-4 py-3 space-y-1 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-muted-foreground/20 hover:[&::-webkit-scrollbar-thumb]:bg-muted-foreground/30">
              {eligibleWalletsQuery.isLoading && (
                <div className="text-sm text-muted-foreground flex items-center gap-2 py-12 justify-center">
                  <Spinner className="size-4" />
                  Loading wallets...
                </div>
              )}
              {!eligibleWalletsQuery.isLoading &&
                visibleWallets.length === 0 && (
                  <div className="text-sm text-muted-foreground py-12 text-center">
                    No eligible wallets found for this token.
                  </div>
                )}
              {!eligibleWalletsQuery.isLoading &&
                visibleWallets.map((wallet) => {
                  const isSelected = selectedWalletPublicKeys.includes(
                    wallet.publicKey
                  );
                  return (
                    <label
                      key={wallet.publicKey}
                      className={cn(
                        "grid grid-cols-[auto_1fr_auto_auto] items-center gap-4 rounded-lg border px-4 py-3 cursor-pointer transition-colors",
                        isSelected
                          ? "border-primary/30 bg-primary/5"
                          : "border-transparent hover:bg-muted/50"
                      )}
                    >
                      <Checkbox
                        checked={isSelected}
                        onCheckedChange={() => toggleWallet(wallet.publicKey)}
                      />
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="font-mono text-xs text-muted-foreground truncate">
                            {wallet.publicKey.slice(0, 6)}...
                            {wallet.publicKey.slice(-4)}
                          </span>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <button
                                type="button"
                                className="text-muted-foreground/40 hover:text-muted-foreground transition-colors shrink-0"
                                onClick={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  copyToClipboard(wallet.publicKey);
                                }}
                              >
                                <CopyIcon className="size-3" />
                              </button>
                            </TooltipTrigger>
                            <TooltipContent>Copy address</TooltipContent>
                          </Tooltip>
                        </div>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="text-[11px] text-muted-foreground/70 uppercase tracking-wide">
                            {wallet.type}
                          </span>
                          <span className="text-[11px] text-muted-foreground tabular-nums">
                            {Number(wallet.balanceSol).toFixed(3)} SOL
                          </span>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-sm tabular-nums">
                          {wallet.tokenBalanceUi > 0
                            ? wallet.tokenBalanceUi.toFixed(4)
                            : "—"}
                        </div>
                        <div className="text-[11px] text-muted-foreground">
                          tokens
                        </div>
                      </div>
                      <div className="text-right w-20">
                        <div className="text-sm tabular-nums">
                          {wallet.tokenBalanceSol !== null &&
                          wallet.tokenBalanceSol > 0
                            ? wallet.tokenBalanceSol.toFixed(3)
                            : "—"}
                        </div>
                        <div className="text-[11px] text-muted-foreground">
                          SOL value
                        </div>
                      </div>
                    </label>
                  );
                })}
            </div>

            {selectedWalletPublicKeys.length > 0 && (
              <>
                <Separator />
                <div className="flex items-center justify-between px-6 py-4">
                  <div className="flex items-center gap-6">
                    <div>
                      <div className="text-sm font-medium tabular-nums">
                        {selectedWalletPublicKeys.length} wallet
                        {selectedWalletPublicKeys.length !== 1 ? "s" : ""}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        selected
                      </div>
                    </div>
                    <div>
                      <div className="text-sm font-medium tabular-nums">
                        {selectedTokenBalance.toFixed(4)}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        tokens
                      </div>
                    </div>
                    <div>
                      <div className="text-sm font-medium tabular-nums">
                        {selectedTokenSolValue > 0
                          ? `~${selectedTokenSolValue.toFixed(3)} SOL`
                          : "—"}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        est. value
                      </div>
                    </div>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => setWalletDialogOpen(false)}
                  >
                    Done
                  </Button>
                </div>
              </>
            )}
          </DialogContent>
        </Dialog>

        <PageSectionDivider />

        <PageSection>
          <PageSectionHeader title="Overview" />

          <div className="grid gap-x-10 gap-y-6 md:grid-cols-4">
            <div className="space-y-1">
              <div className="text-xs text-muted-foreground">
                Volume per minute
              </div>
              <div className="text-xl font-light tabular-nums">
                {formatNumber(effectivePreflight?.volumePerMinute?.min)}
                <span className="text-muted-foreground mx-0.5">–</span>
                {formatNumber(effectivePreflight?.volumePerMinute?.max)}
                <span className="ml-1 text-xs text-muted-foreground">SOL</span>
              </div>
            </div>
            <div className="space-y-1">
              <div className="text-xs text-muted-foreground">Total volume</div>
              <div className="text-xl font-light tabular-nums">
                {formatNumber(effectivePreflight?.totalVolume?.min)}
                <span className="text-muted-foreground mx-0.5">–</span>
                {formatNumber(effectivePreflight?.totalVolume?.max)}
                <span className="ml-1 text-xs text-muted-foreground">SOL</span>
              </div>
            </div>
            <div className="space-y-1">
              <div className="text-xs text-muted-foreground">Net direction</div>
              <div className="text-xl font-light">{netDirectionLabel}</div>
            </div>
            <div className="space-y-1">
              <div className="text-xs text-muted-foreground">
                Suggested funding
              </div>
              <div className="text-xl font-light tabular-nums">
                {suggestedFunding ? suggestedFunding.toFixed(2) : "—"}
                <span className="ml-1 text-xs text-muted-foreground">SOL</span>
              </div>
            </div>
            <div className="space-y-1">
              <div className="text-xs text-muted-foreground">
                Generated wallet fee
              </div>
              <div className="text-sm tabular-nums">
                {usageFees.generatedWalletCount} x 0.02 ={" "}
                {usageFees.generatedWalletFeeSol.toFixed(4)} SOL
              </div>
            </div>
            <div className="space-y-1">
              <div className="text-xs text-muted-foreground">Total usage fee</div>
              <div className="text-sm tabular-nums">
                {usageFees.totalFeeSol.toFixed(4)} SOL
              </div>
            </div>
            <div className="space-y-1">
              <div className="text-xs text-muted-foreground">
                Est. total outflow
              </div>
              <div className="text-sm tabular-nums">
                {estimatedTotalOutflowSol.toFixed(4)} SOL
              </div>
            </div>
            <div className="space-y-1">
              <div className="text-xs text-muted-foreground">
                Net Δ SOL / min
              </div>
              <div className="text-sm tabular-nums">
                {formatNumber(
                  selectionSummary?.netSolRangePerMinute?.min ??
                    localPreflight?.netSolRangePerMinute?.min
                )}
                <span className="text-muted-foreground mx-0.5">–</span>
                {formatNumber(
                  selectionSummary?.netSolRangePerMinute?.max ??
                    localPreflight?.netSolRangePerMinute?.max
                )}{" "}
                SOL
              </div>
            </div>
            <div className="space-y-1">
              <div className="text-xs text-muted-foreground">
                Total net Δ SOL
              </div>
              <div className="text-sm tabular-nums">
                {formatNumber(
                  selectionSummary?.netSolRangeTotal?.min ??
                    localPreflight?.netSolRangeTotal?.min
                )}
                <span className="text-muted-foreground mx-0.5">–</span>
                {formatNumber(
                  selectionSummary?.netSolRangeTotal?.max ??
                    localPreflight?.netSolRangeTotal?.max
                )}{" "}
                SOL
              </div>
            </div>
            <div className="space-y-1">
              <div className="text-xs text-muted-foreground">
                Avg trade size
              </div>
              <div className="text-sm tabular-nums">
                {formatNumber(effectivePreflight?.avgTradeSizeWeighted)} SOL
              </div>
            </div>
            <div className="space-y-1">
              <div className="text-xs text-muted-foreground">
                Trades per wallet
              </div>
              <div className="text-sm tabular-nums">
                {formatNumber(effectivePreflight?.estimatedTradesPerWallet)}
              </div>
            </div>
          </div>

          {(fundingBelowSuggested ||
            selectionSummaryQuery.error ||
            sellWarning ||
            ranges.some((r) => r.intervalMin < 5) ||
            (netSolDirection < 0 && selectedWalletPublicKeys.length === 0)) && (
            <div className="space-y-2.5">
              {selectionSummaryQuery.error && (
                <div className="flex items-start gap-2.5 text-sm text-red-400">
                  <OctagonAlertIcon className="size-4 shrink-0 mt-0.5" />
                  <span>{selectionSummaryQuery.error.message}</span>
                </div>
              )}
              {netSolDirection < 0 && selectedWalletPublicKeys.length === 0 && (
                <div className="flex items-start gap-2.5 text-sm text-red-400">
                  <OctagonAlertIcon className="size-4 shrink-0 mt-0.5" />
                  <span>
                    Net sell sessions require wallets with token holdings.
                  </span>
                </div>
              )}
              {fundingBelowSuggested && (
                <div className="flex items-start gap-2.5 text-sm text-amber-400">
                  <AlertTriangleIcon className="size-4 shrink-0 mt-0.5" />
                  <span>
                    Funding per generated wallet is below the suggested amount.
                  </span>
                </div>
              )}
              {sellWarning && (
                <div className="flex items-start gap-2.5 text-sm text-amber-400">
                  <AlertTriangleIcon className="size-4 shrink-0 mt-0.5" />
                  <span>
                    Selected wallets may not have sufficient tokens for
                    configured sell volume.
                  </span>
                </div>
              )}
              {ranges.some((r) => r.intervalMin < 5) && (
                <div className="flex items-start gap-2.5 text-sm text-muted-foreground">
                  <InfoIcon className="size-4 shrink-0 mt-0.5" />
                  <span>
                    Intervals below 5s use gRPC streaming. Max{" "}
                    {Math.floor(
                      18 * Math.min(...ranges.map((r) => r.intervalMin))
                    )}{" "}
                    wallets allowed.
                  </span>
                </div>
              )}
            </div>
          )}
        </PageSection>

        <div className="-mx-6 -mb-14 mt-14 border-t bg-muted/30 px-6 py-14">
          <div className="flex items-center justify-between gap-8">
            <div className="flex items-center gap-10">
              <div className="space-y-1">
                <div className="text-xs text-muted-foreground">
                  Total wallets
                </div>
                <div className="text-2xl font-light tabular-nums">
                  {totalWallets}
                </div>
              </div>
              <div className="space-y-1">
                <div className="text-xs text-muted-foreground">
                  Total funding
                </div>
                <div className="text-2xl font-light tabular-nums">
                  {(totalFunding + totalTopUp).toFixed(2)}
                  <span className="ml-1 text-sm text-muted-foreground">
                    SOL
                  </span>
                </div>
              </div>
              <div className="space-y-1">
                <div className="text-xs text-muted-foreground">Usage fee</div>
                <div className="text-2xl font-light tabular-nums">
                  {usageFees.totalFeeSol.toFixed(2)}
                  <span className="ml-1 text-sm text-muted-foreground">
                    SOL
                  </span>
                </div>
              </div>
              <div className="space-y-1">
                <div className="text-xs text-muted-foreground">Total outflow</div>
                <div className="text-2xl font-light tabular-nums">
                  {estimatedTotalOutflowSol.toFixed(2)}
                  <span className="ml-1 text-sm text-muted-foreground">
                    SOL
                  </span>
                </div>
              </div>
              <div className="space-y-1">
                <div className="text-xs text-muted-foreground">Duration</div>
                <div className="text-2xl font-light">
                  {formatDuration(targetDurationSeconds)}
                </div>
              </div>
            </div>
            <Button
              size="lg"
              onClick={handleStart}
              disabled={startMutation.isPending || !tokenPublicKey || isRunning}
              className="h-12 px-4 text-3xl font-black tracking-tight shadow-lg shadow-lime-400/10 border border-black hover:shadow-xl hover:shadow-lime-300/20 text-black/90 hover:text-black shrink-0"
            >
              {startMutation.isPending ? "STARTING..." : "START VOLUME BOT"}
            </Button>
          </div>
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
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Usage fee</span>
              <span className="font-semibold">
                {usageFees.totalFeeSol.toFixed(4)} SOL
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Total outflow</span>
              <span className="font-semibold">
                {estimatedTotalOutflowSol.toFixed(4)} SOL
              </span>
            </div>
            {scheduledStartEnabled && scheduledStartDate && (
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Scheduled start</span>
                <span className="font-semibold">
                  {format(scheduledStartDate, "MMM d, yyyy  HH:mm")}
                </span>
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

      <Dialog open={presetsDialogOpen} onOpenChange={setPresetsDialogOpen}>
        <DialogContent className="sm:max-w-xl max-h-[80vh] flex flex-col gap-0 p-0">
          <div className="px-6 pt-6 pb-4">
            <DialogHeader>
              <DialogTitle>Presets</DialogTitle>
            </DialogHeader>
          </div>
          <Separator />
          <div className="flex-1 overflow-y-auto px-6 py-4 space-y-2 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-muted-foreground/20 hover:[&::-webkit-scrollbar-thumb]:bg-muted-foreground/30">
            {presetsQuery.isLoading && (
              <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
                <Spinner className="size-4 mr-2" />
                Loading presets...
              </div>
            )}
            {!presetsQuery.isLoading &&
              (presetsQuery.data ?? []).length === 0 && (
                <div className="text-center py-12 space-y-2">
                  <p className="text-sm text-muted-foreground">
                    No presets saved yet
                  </p>
                  <p className="text-xs text-muted-foreground/70">
                    Configure your volume bot and save it as a preset for quick
                    access later.
                  </p>
                </div>
              )}
            {!presetsQuery.isLoading &&
              (presetsQuery.data ?? []).map((preset) => {
                const isActive = selectedPresetId === preset.id;
                const config = preset.config as VolumeBotConfigInput;
                const isEditing = editingPresetId === preset.id;
                return (
                  <div
                    key={preset.id}
                    className={cn(
                      "rounded-lg border p-4 transition-colors",
                      isActive
                        ? "border-primary/30 bg-primary/5"
                        : "hover:bg-muted/30"
                    )}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        {isEditing ? (
                          <Input
                            value={editingPresetName}
                            onChange={(e) =>
                              setEditingPresetName(e.target.value)
                            }
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                handleRenamePreset(
                                  preset.id,
                                  editingPresetName
                                );
                              }
                              if (e.key === "Escape") {
                                setEditingPresetId(null);
                              }
                            }}
                            onBlur={() =>
                              handleRenamePreset(preset.id, editingPresetName)
                            }
                            autoFocus
                            className="h-7 text-sm font-medium"
                          />
                        ) : (
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium truncate">
                              {preset.name}
                            </span>
                            {isActive && (
                              <span className="text-[10px] text-primary font-medium uppercase tracking-wider">
                                Active
                              </span>
                            )}
                          </div>
                        )}
                        {config && (
                          <p className="text-xs text-muted-foreground mt-1 truncate">
                            {formatPresetSummary(config)}
                          </p>
                        )}
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-sm"
                              className="text-muted-foreground hover:text-foreground"
                              onClick={() => {
                                setEditingPresetId(preset.id);
                                setEditingPresetName(preset.name);
                              }}
                            >
                              <PencilIcon className="size-3.5" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>Rename</TooltipContent>
                        </Tooltip>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-sm"
                              className="text-muted-foreground hover:text-destructive"
                              disabled={deletePresetMutation.isPending}
                              onClick={() => handleDeletePreset(preset.id)}
                            >
                              <Trash2Icon className="size-3.5" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>Delete</TooltipContent>
                        </Tooltip>
                        <Button
                          type="button"
                          variant={isActive ? "secondary" : "outline"}
                          size="sm"
                          className="ml-1"
                          onClick={() => requestLoadPreset(preset.id)}
                        >
                          {isActive ? "Reload" : "Load"}
                        </Button>
                      </div>
                    </div>
                  </div>
                );
              })}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={createPresetDialogOpen}
        onOpenChange={(open) => {
          setCreatePresetDialogOpen(open);
          if (!open) {
            setCreatePresetMode(null);
            setNewPresetName("");
          }
        }}
      >
        <DialogContent className="sm:max-w-md p-0 gap-0">
          <div className="px-6 pt-6 pb-5">
            <DialogHeader>
              <DialogTitle>Save preset</DialogTitle>
            </DialogHeader>
          </div>

          <Separator />

          {selectedPresetId && createPresetMode === null ? (
            <div className="px-6 py-6 space-y-5">
              <p className="text-sm text-muted-foreground">
                You have{" "}
                <span className="text-foreground font-medium">
                  {selectedPreset?.name}
                </span>{" "}
                loaded. What would you like to do?
              </p>
              <div className="grid gap-3">
                <button
                  type="button"
                  className="flex items-start gap-4 rounded-lg border p-4 text-left transition-colors hover:bg-muted/50 disabled:opacity-50"
                  onClick={() => handleSavePreset(selectedPreset?.name)}
                  disabled={savePresetMutation.isPending}
                >
                  <div className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted">
                    <RefreshCwIcon className="size-4 text-muted-foreground" />
                  </div>
                  <div>
                    <div className="text-sm font-medium">
                      {savePresetMutation.isPending ? (
                        <span className="flex items-center gap-1.5">
                          <Spinner className="size-3" />
                          Saving...
                        </span>
                      ) : (
                        "Overwrite current"
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      Update &quot;{selectedPreset?.name}&quot; with the current
                      configuration
                    </p>
                  </div>
                </button>
                <button
                  type="button"
                  className="flex items-start gap-4 rounded-lg border p-4 text-left transition-colors hover:bg-muted/50"
                  onClick={() => {
                    setCreatePresetMode("new");
                    setNewPresetName("");
                  }}
                >
                  <div className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted">
                    <PlusIcon className="size-4 text-muted-foreground" />
                  </div>
                  <div>
                    <div className="text-sm font-medium">
                      Save as new preset
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      Create a new preset with a different name
                    </p>
                  </div>
                </button>
              </div>
            </div>
          ) : (
            <div className="px-6 py-6 space-y-5">
              <div className="flex items-start gap-4">
                <div className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted">
                  <LayersIcon className="size-4 text-muted-foreground" />
                </div>
                <div className="flex-1 space-y-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">
                      Preset name
                    </Label>
                    <Input
                      value={newPresetName}
                      onChange={(e) => setNewPresetName(e.target.value)}
                      placeholder="e.g. Aggressive buy"
                      autoFocus
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          handleSavePreset(newPresetName);
                        }
                      }}
                    />
                  </div>
                  {newPresetName.trim() &&
                    presetsQuery.data?.some(
                      (p) =>
                        p.name.toLowerCase() ===
                        newPresetName.trim().toLowerCase()
                    ) && (
                      <p className="text-xs text-amber-400">
                        A preset with this name already exists and will be
                        overwritten.
                      </p>
                    )}
                </div>
              </div>
            </div>
          )}

          <Separator />

          <div className="flex items-center justify-end gap-2 px-6 py-4">
            {selectedPresetId && createPresetMode === "new" && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setCreatePresetMode(null)}
              >
                Back
              </Button>
            )}
            {(createPresetMode === "new" || !selectedPresetId) && (
              <Button
                type="button"
                size="sm"
                disabled={!newPresetName.trim() || savePresetMutation.isPending}
                onClick={() => handleSavePreset(newPresetName)}
              >
                {savePresetMutation.isPending ? (
                  <>
                    <Spinner className="mr-1.5 size-3" />
                    Saving...
                  </>
                ) : (
                  <>
                    <SaveIcon className="size-3.5 mr-1.5" />
                    Save preset
                  </>
                )}
              </Button>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={!!pendingLoadPresetId}
        onOpenChange={(open) => {
          if (!open) setPendingLoadPresetId(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Unsaved changes</AlertDialogTitle>
            <AlertDialogDescription>
              Your current configuration has unsaved changes. Loading a preset
              will overwrite them. Do you want to continue?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmLoadPreset}>
              Load preset
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
