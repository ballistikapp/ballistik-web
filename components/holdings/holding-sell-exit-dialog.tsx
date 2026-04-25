"use client";

import * as React from "react";
import Link from "next/link";
import { ExternalLink, Info, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@/server/trpc/routers/_app";
import { trpc } from "@/lib/trpc/client";
import { cn } from "@/lib/utils";
import { bundledExitFeeSol } from "@/lib/config/usage-fees.config";
import { DEVELOPER_FEE_DISCOUNT_RATE } from "@/lib/config/subscription.config";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

type RouterOutputs = inferRouterOutputs<AppRouter>;
type ExitStatusOutput = RouterOutputs["holding"]["exitStatus"];
type ExitActiveOutput = RouterOutputs["holding"]["getActiveExit"];
type ExitData = ExitStatusOutput | ExitActiveOutput | null;
type HoldingOutput = RouterOutputs["holding"]["listByToken"]["holdings"][number];

type HoldingSummary = {
  walletPublicKey: string;
  tokenBalance: number;
};

type HoldingSellExitDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tokenPublicKey: string;
  tokenSymbol: string;
  initialTab?: "sell" | "exit";
  initialHoldings?: HoldingSummary[];
  selectedHoldings?: HoldingSummary[];
  shouldRefreshOnOpen?: boolean;
  exit: ExitData;
  totalWallets: number;
  walletsWithBalance: number;
  totalBalance: number;
  isSelling?: boolean;
  isStartingExit?: boolean;
  isCancellingExit?: boolean;
  onSell: (
    walletPublicKeys: string[],
    sellPercentage: number,
    closeAta: boolean,
    returnSolToMainWallet: boolean
  ) => Promise<void>;
  onExit: (jitoTipSol: number, returnSolToMainWallet: boolean) => Promise<void>;
  onCancelExit?: () => Promise<void>;
  onHoldingsRefreshed?: () => void;
};

const EXIT_CHUNK_SIZE = 20;
const SELL_LIST_PAGE_SIZE = 100;

const statusVariantMap: Record<
  string,
  "default" | "secondary" | "destructive" | "outline"
> = {
  PENDING: "secondary",
  RUNNING: "default",
  PARTIAL_SUCCESS: "secondary",
  SUCCEEDED: "outline",
  FAILED: "destructive",
};

const statusLabelMap: Record<string, string> = {
  PENDING: "Pending",
  RUNNING: "Running",
  PARTIAL_SUCCESS: "Partial Success",
  SUCCEEDED: "Succeeded",
  FAILED: "Failed",
};

function mapHoldingToSummary(holding: HoldingOutput): HoldingSummary {
  return {
    walletPublicKey: holding.wallet.publicKey,
    tokenBalance: Number(holding.tokenBalance),
  };
}

function dedupeHoldings(holdings: HoldingSummary[]) {
  return Array.from(
    new Map(holdings.map((holding) => [holding.walletPublicKey, holding]))
      .values()
  );
}

function shortenPublicKey(publicKey: string) {
  return `${publicKey.slice(0, 4)}...${publicKey.slice(-4)}`;
}

function formatTokenAmount(value: number) {
  return value >= 0.01 ? value.toFixed(4) : value.toFixed(6);
}

function roundSol(amount: number) {
  return Math.round(amount * 1_000_000_000) / 1_000_000_000;
}

export function HoldingSellExitDialog({
  open,
  onOpenChange,
  tokenPublicKey,
  tokenSymbol,
  initialTab = "sell",
  initialHoldings = [],
  selectedHoldings,
  shouldRefreshOnOpen = false,
  exit,
  totalWallets,
  walletsWithBalance,
  totalBalance,
  isSelling = false,
  isStartingExit = false,
  isCancellingExit = false,
  onSell,
  onExit,
  onCancelExit,
  onHoldingsRefreshed,
}: HoldingSellExitDialogProps) {
  const [activeTab, setActiveTab] = React.useState<"sell" | "exit">(initialTab);
  const [percentage, setPercentage] = React.useState("100");
  const [closeAta, setCloseAta] = React.useState(true);
  const [sellReturnSolToMainWallet, setSellReturnSolToMainWallet] =
    React.useState(true);
  const [selectedWallets, setSelectedWallets] = React.useState<
    Record<string, boolean>
  >({});
  const [tip, setTip] = React.useState("0.005");
  const [exitReturnSolToMainWallet, setExitReturnSolToMainWallet] =
    React.useState(true);
  const [isPreparingSell, setIsPreparingSell] = React.useState(false);
  const [exitConfirmOpen, setExitConfirmOpen] = React.useState(false);
  const [dialogHoldings, setDialogHoldings] = React.useState<HoldingSummary[]>(
    []
  );
  const autoRefreshRunRef = React.useRef(false);

  const { data: currentUser } = trpc.auth.me.useQuery();
  const selectedMode = Boolean(selectedHoldings);
  const { mutateAsync: refreshHoldingsByToken } =
    trpc.holding.refreshByToken.useMutation();
  const { refetch: refetchSellHoldings } = trpc.holding.listByToken.useQuery(
    {
      tokenPublicKey,
      page: 1,
      pageSize: SELL_LIST_PAGE_SIZE,
    },
    {
      enabled: false,
    }
  );

  const sellHoldings = React.useMemo(
    () => dedupeHoldings(selectedHoldings ?? dialogHoldings),
    [dialogHoldings, selectedHoldings]
  );

  const refreshSellHoldings = React.useCallback(async () => {
    setIsPreparingSell(true);
    try {
      await refreshHoldingsByToken({ tokenPublicKey });
      const result = await refetchSellHoldings();
      const nextHoldings = dedupeHoldings(
        (result.data?.holdings ?? [])
          .map(mapHoldingToSummary)
          .filter((holding) => holding.tokenBalance > 0)
      );
      setDialogHoldings(nextHoldings);
      setSelectedWallets(
        Object.fromEntries(
          nextHoldings.map((holding) => [holding.walletPublicKey, true])
        )
      );
      onHoldingsRefreshed?.();
    } catch {
      toast.error("Failed to refresh holdings for sell dialog");
    } finally {
      setIsPreparingSell(false);
    }
  }, [
    onHoldingsRefreshed,
    refetchSellHoldings,
    refreshHoldingsByToken,
    tokenPublicKey,
  ]);

  React.useEffect(() => {
    if (!open) return;
    setActiveTab(initialTab);
  }, [initialTab, open]);

  React.useEffect(() => {
    if (!open) return;

    if (selectedMode) return;

    const nextHoldings = dedupeHoldings(
      initialHoldings.filter((holding) => holding.tokenBalance > 0)
    );
    setDialogHoldings(nextHoldings);
    setSelectedWallets(
      Object.fromEntries(
        nextHoldings.map((holding) => [holding.walletPublicKey, true])
      )
    );

    if (shouldRefreshOnOpen && !autoRefreshRunRef.current) {
      autoRefreshRunRef.current = true;
      void refreshSellHoldings();
    }
  }, [
    initialHoldings,
    open,
    refreshSellHoldings,
    selectedMode,
    shouldRefreshOnOpen,
  ]);

  React.useEffect(() => {
    if (open) return;
    setPercentage("100");
    setCloseAta(true);
    setSellReturnSolToMainWallet(true);
    setTip("0.005");
    setExitReturnSolToMainWallet(true);
    setExitConfirmOpen(false);
    setSelectedWallets({});
    setDialogHoldings([]);
    autoRefreshRunRef.current = false;
  }, [open]);

  React.useEffect(() => {
    if (!open || !selectedMode) return;
    setSelectedWallets(
      Object.fromEntries(
        sellHoldings.map((holding) => [holding.walletPublicKey, true])
      )
    );
  }, [open, selectedMode, sellHoldings]);

  const parsedPercentage = Number.parseFloat(percentage);
  const canCloseAta =
    Number.isFinite(parsedPercentage) && parsedPercentage === 100;
  const selectedSellHoldings = React.useMemo(
    () => sellHoldings.filter((holding) => selectedWallets[holding.walletPublicKey]),
    [selectedWallets, sellHoldings]
  );
  const selectedSellBalance = React.useMemo(
    () =>
      selectedSellHoldings.reduce(
        (sum, holding) =>
          sum +
          (Number.isFinite(holding.tokenBalance) ? holding.tokenBalance : 0),
        0
      ),
    [selectedSellHoldings]
  );
  const selectedWalletLabel = `${selectedSellHoldings.length} / ${sellHoldings.length}`;

  const handleOpenChange = (nextOpen: boolean) => {
    onOpenChange(nextOpen);
  };

  const setAllSellWallets = (checked: boolean) => {
    setSelectedWallets(
      Object.fromEntries(
        sellHoldings.map((holding) => [holding.walletPublicKey, checked])
      )
    );
  };

  const handleSellConfirm = async () => {
    if (
      !Number.isFinite(parsedPercentage) ||
      parsedPercentage <= 0 ||
      parsedPercentage > 100
    ) {
      toast.error("Enter a percentage between 1 and 100");
      return;
    }

    const walletPublicKeys = selectedSellHoldings.map(
      (holding) => holding.walletPublicKey
    );
    if (walletPublicKeys.length === 0) {
      toast.error("Select at least one wallet");
      return;
    }

    await onSell(
      walletPublicKeys,
      parsedPercentage,
      canCloseAta && closeAta,
      sellReturnSolToMainWallet
    );
  };

  const handleExitConfirm = async () => {
    const parsed = Number.parseFloat(tip);
    if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
      toast.error("Enter a tip between 0 and 1 SOL");
      return;
    }
    if (walletsWithBalance === 0) {
      toast.error("No wallets with balances available");
      return;
    }
    await onExit(parsed, exitReturnSolToMainWallet);
    setExitConfirmOpen(false);
  };

  const handleExitClick = () => {
    const parsed = Number.parseFloat(tip);
    if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
      toast.error("Enter a tip between 0 and 1 SOL");
      return;
    }
    if (walletsWithBalance === 0) {
      toast.error("No wallets with balances available");
      return;
    }
    setExitConfirmOpen(true);
  };

  const status = exit?.status ?? "PENDING";
  const progress = exit?.progress ?? 0;
  const canClose =
    status === "SUCCEEDED" ||
    status === "PARTIAL_SUCCESS" ||
    status === "FAILED" ||
    status === "RUNNING";
  const summary = exit?.result as
    | {
        totalWallets?: number;
        totalChunks?: number;
        successfulChunks?: number;
        failedChunks?: number;
        totalTokensUi?: number;
        tokenDecimals?: number;
        bundlesProcessed?: number;
        walletsFunded?: number;
        fundingLamports?: number;
        atasClosed?: number;
        solRecoveredSol?: number;
        cleanupFailedWallets?: number;
        requestedReturnSolToMainWallet?: boolean;
        effectiveReturnSolToMainWallet?: boolean;
        systemDevImmediateSweeps?: number;
        systemDevImmediateSweepFailures?: number;
        systemDevImmediateSweepLamports?: number;
        totalJitoTipSol?: number;
        exitFeeSol?: number;
        exitFeeCollected?: boolean;
      }
    | undefined;
  const exitInput = exit?.input as
    | { jitoTipSol?: number; returnSolToMainWallet?: boolean }
    | undefined;
  const parsedTip = Number.parseFloat(tip);
  const localTipSol =
    Number.isFinite(parsedTip) && parsedTip >= 0 ? parsedTip : 0;
  const activeTipSol =
    typeof exitInput?.jitoTipSol === "number" ? exitInput.jitoTipSol : localTipSol;
  const activeReturnSolToMainWallet =
    typeof summary?.effectiveReturnSolToMainWallet === "boolean"
      ? summary.effectiveReturnSolToMainWallet
      : typeof exitInput?.returnSolToMainWallet === "boolean"
        ? exitInput.returnSolToMainWallet
        : exitReturnSolToMainWallet;
  const estimatedBundles =
    walletsWithBalance > 0 ? Math.ceil(walletsWithBalance / EXIT_CHUNK_SIZE) : 0;
  const estimatedTotalTipSol = activeTipSol * estimatedBundles;
  const exitFeeDiscountRate =
    currentUser?.plan === "PRO"
      ? 1
      : currentUser?.plan === "DEVELOPER"
        ? DEVELOPER_FEE_DISCOUNT_RATE
        : 0;
  const exitFeeSol =
    exitFeeDiscountRate >= 1
      ? 0
      : roundSol(bundledExitFeeSol * (1 - exitFeeDiscountRate));
  const exitFeeWaived = exitFeeDiscountRate >= 1;
  const exitFeeDiscounted = exitFeeDiscountRate > 0 && !exitFeeWaived;

  const showProgress = Boolean(exit);
  const showSummary =
    (status === "SUCCEEDED" || status === "PARTIAL_SUCCESS") && summary;
  const showError = status === "FAILED" && exit?.errorMessage;
  const showCleanupWarning =
    status === "PARTIAL_SUCCESS" &&
    (exit?.errorMessage || (summary?.cleanupFailedWallets ?? 0) > 0);
  const activityItems = React.useMemo(
    () =>
      [...(exit?.logs ?? [])]
        .sort(
          (left, right) =>
            new Date(right.createdAt).getTime() -
            new Date(left.createdAt).getTime()
        )
        .map((log, index) => ({
          ...log,
          isLatest: index === 0,
        })),
    [exit?.logs]
  );

  return (
    <>
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="grid max-h-[min(90vh,760px)] min-w-0 max-w-lg grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden p-0 sm:max-w-lg">
        <DialogHeader className="min-w-0 border-b px-4 py-3 pr-12">
          <DialogTitle className="flex flex-wrap items-center gap-2">
            SELL
            <Badge variant="secondary" className="text-xs font-mono">
              ${tokenSymbol}
            </Badge>
            {showProgress && activeTab === "exit" ? (
              <Badge variant={statusVariantMap[status] ?? "secondary"}>
                {statusLabelMap[status] ?? status}
              </Badge>
            ) : null}
          </DialogTitle>
        </DialogHeader>

        <div className="min-h-0 min-w-0 overflow-x-hidden overflow-y-auto px-4 py-3">
        <Tabs
          value={activeTab}
          onValueChange={(value) => setActiveTab(value as "sell" | "exit")}
          className="min-w-0"
        >
          <TabsList className="grid w-full min-w-0 grid-cols-2">
            <TabsTrigger value="sell">Sell</TabsTrigger>
            <TabsTrigger value="exit">Exit</TabsTrigger>
          </TabsList>

          <TabsContent value="sell" className="flex min-w-0 flex-col gap-4">
            <div className="grid min-w-0 grid-cols-2 gap-2">
              <div className="min-w-0 overflow-hidden rounded-md border p-2">
                <div className="text-[11px] text-muted-foreground">Wallets</div>
                <div className="mt-1 font-mono text-sm">{selectedWalletLabel}</div>
              </div>
              <div className="min-w-0 overflow-hidden rounded-md border p-2">
                <div className="text-[11px] text-muted-foreground">Selected balance</div>
                <div
                  className="mt-1 wrap-break-word font-mono text-sm leading-snug"
                  title={`${formatTokenAmount(selectedSellBalance)} ${tokenSymbol}`}
                >
                  {formatTokenAmount(selectedSellBalance)} {tokenSymbol}
                </div>
              </div>
            </div>

            <div className="min-w-0 overflow-hidden rounded-md border">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b px-3 py-2 sm:gap-3">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">Wallets with holdings</div>
                  {selectedMode ? (
                    <div className="text-xs text-muted-foreground">
                      Selected table rows only
                    </div>
                  ) : null}
                </div>
                <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
                  {!selectedMode ? (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-xs"
                          className="text-muted-foreground hover:text-foreground"
                          onClick={() => void refreshSellHoldings()}
                          disabled={isPreparingSell}
                          aria-label="Refresh holdings"
                        >
                          <RefreshCw
                            className={cn(isPreparingSell && "animate-spin")}
                            aria-hidden
                          />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent side="top">
                        {isPreparingSell ? "Refreshing…" : "Refresh holdings"}
                      </TooltipContent>
                    </Tooltip>
                  ) : null}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setAllSellWallets(false)}
                    disabled={isPreparingSell || sellHoldings.length === 0}
                  >
                    Clear
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setAllSellWallets(true)}
                    disabled={isPreparingSell || sellHoldings.length === 0}
                  >
                    All
                  </Button>
                </div>
              </div>
              <div className="max-h-[34vh] min-h-28 min-w-0 overflow-y-auto overflow-x-hidden p-1.5">
                {isPreparingSell ? (
                  <div className="flex items-center justify-center gap-2 p-6 text-sm text-muted-foreground">
                    <Spinner className="size-4" />
                    Refreshing holdings...
                  </div>
                ) : sellHoldings.length === 0 ? (
                  <div className="p-6 text-center text-sm text-muted-foreground">
                    No wallets with token balances found.
                  </div>
                ) : (
                  <div className="flex flex-col gap-1">
                    {sellHoldings.map((holding) => (
                      <label
                        key={holding.walletPublicKey}
                        className="grid min-w-0 cursor-default [grid-template-columns:1.25rem_minmax(0,1fr)_minmax(0,1fr)] items-center gap-x-2 gap-y-0 rounded-md px-2 py-1.5 hover:bg-muted/50"
                      >
                        <Checkbox
                          checked={Boolean(selectedWallets[holding.walletPublicKey])}
                          onCheckedChange={(value) =>
                            setSelectedWallets((current) => ({
                              ...current,
                              [holding.walletPublicKey]: Boolean(value),
                            }))
                          }
                        />
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Link
                              href={`/${tokenPublicKey}/wallets/${holding.walletPublicKey}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="group inline-flex w-fit min-w-0 max-w-full cursor-pointer items-center gap-1 justify-self-start font-mono text-xs no-underline"
                              aria-label="Go to wallet"
                              onClick={(event) => event.stopPropagation()}
                            >
                              <span className="underline-offset-2 group-hover:underline">
                                {shortenPublicKey(holding.walletPublicKey)}
                              </span>
                              <ExternalLink
                                className="size-3 shrink-0 text-muted-foreground opacity-80"
                                aria-hidden
                              />
                            </Link>
                          </TooltipTrigger>
                          <TooltipContent side="top">Go to wallet</TooltipContent>
                        </Tooltip>
                        <span className="min-w-0 text-right font-mono text-xs wrap-break-word tabular-nums text-muted-foreground">
                          {formatTokenAmount(holding.tokenBalance)} {tokenSymbol}
                        </span>
                      </label>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="grid min-w-0 gap-2">
              <div className="flex min-w-0 items-center justify-between gap-3">
                <Label htmlFor="sellPercentage">Sell percentage</Label>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setPercentage("100");
                    setCloseAta(true);
                  }}
                >
                  100%
                </Button>
              </div>
              <Input
                id="sellPercentage"
                type="number"
                min="1"
                max="100"
                step="1"
                value={percentage}
                onChange={(event) => {
                  const nextPercentage = event.target.value;
                  setPercentage(nextPercentage);
                  if (Number.parseFloat(nextPercentage) !== 100) {
                    setCloseAta(false);
                  }
                }}
              />
            </div>
            <div className="flex min-w-0 items-start gap-3 rounded-md border p-3">
              <Checkbox
                id="closeAta"
                checked={closeAta}
                onCheckedChange={(value) => setCloseAta(Boolean(value))}
                disabled={!canCloseAta}
              />
              <div className="grid min-w-0 gap-1">
                <div className="flex min-w-0 items-center gap-1.5">
                  <Label htmlFor="closeAta">Close empty token accounts</Label>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        className="shrink-0 text-muted-foreground transition-colors hover:text-foreground"
                        aria-label="About closing empty token accounts"
                      >
                        <Info className="size-3.5" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="top" className="max-w-sm">
                      Closes associated token accounts when the balance is
                      zero.{" "}
                      {!canCloseAta
                        ? "Enable when selling 100% so accounts can be emptied first."
                        : null}
                    </TooltipContent>
                  </Tooltip>
                </div>
              </div>
            </div>
            <div className="flex min-w-0 items-start gap-3 rounded-md border p-3">
              <Checkbox
                id="sellReturnSolToMainWallet"
                checked={sellReturnSolToMainWallet}
                onCheckedChange={(value) =>
                  setSellReturnSolToMainWallet(Boolean(value))
                }
              />
              <div className="grid min-w-0 gap-1">
                <div className="flex min-w-0 items-center gap-1.5">
                  <Label htmlFor="sellReturnSolToMainWallet">
                    Return SOL to main wallet
                  </Label>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        className="shrink-0 text-muted-foreground transition-colors hover:text-foreground"
                        aria-label="About returning SOL to main wallet"
                      >
                        <Info className="size-3.5" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="top" className="max-w-sm">
                      After processing selected wallets, send each processed
                      wallet&apos;s spendable SOL balance back to the main
                      wallet. System dev wallet proceeds are always swept back
                      to main.
                    </TooltipContent>
                  </Tooltip>
                </div>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="exit" className="flex min-w-0 flex-col gap-4">
            {!showProgress && (
              <>
                <div className="grid min-w-0 gap-2">
                  <div className="grid min-w-0 grid-cols-[1fr_minmax(0,1fr)] items-baseline gap-2 text-sm text-muted-foreground">
                    <span className="min-w-0">Wallets</span>
                    <span className="min-w-0 text-right font-mono tabular-nums">
                      {totalWallets}
                    </span>
                  </div>
                  <div className="grid min-w-0 grid-cols-[1fr_minmax(0,1fr)] items-baseline gap-2 text-sm text-muted-foreground">
                    <span className="min-w-0">Total balance</span>
                    <span className="min-w-0 wrap-break-word text-right font-mono text-xs leading-snug sm:text-sm">
                      {totalBalance.toFixed(4)} {tokenSymbol}
                    </span>
                  </div>
                  <div className="grid min-w-0 grid-cols-[1fr_minmax(0,1fr)] items-baseline gap-2 text-sm text-muted-foreground">
                    <span className="min-w-0">Wallets with balance</span>
                    <span className="min-w-0 text-right font-mono tabular-nums">
                      {walletsWithBalance}
                    </span>
                  </div>
                </div>
                <div className="grid min-w-0 gap-2">
                  <Label htmlFor="exitTip">Jito tip (SOL)</Label>
                  <Input
                    id="exitTip"
                    type="number"
                    min="0"
                    max="1"
                    step="0.0001"
                    value={tip}
                    onChange={(event) => setTip(event.target.value)}
                  />
                </div>
                <div className="flex min-w-0 items-start gap-3 rounded-md border p-3">
                  <Checkbox
                    id="exitReturnSolToMainWallet"
                    checked={exitReturnSolToMainWallet}
                    onCheckedChange={(value) =>
                      setExitReturnSolToMainWallet(Boolean(value))
                    }
                  />
                  <div className="grid gap-1">
                    <div className="flex items-center gap-1.5">
                      <Label htmlFor="exitReturnSolToMainWallet">
                        Return SOL to main wallet
                      </Label>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            type="button"
                            className="text-muted-foreground transition-colors hover:text-foreground"
                            aria-label="About returning SOL to main wallet"
                          >
                            <Info className="size-3.5" />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent side="top" className="max-w-sm">
                          After exit processing, spendable SOL from processed
                          wallets is sent back to your main wallet. System dev
                          wallet proceeds are always swept back to main.
                        </TooltipContent>
                      </Tooltip>
                    </div>
                  </div>
                </div>
                <div className="min-w-0 overflow-hidden rounded-md border p-3 text-xs text-muted-foreground">
                  <p className="min-w-0 wrap-break-word">
                    Exit sells tokens across managed wallets, closes empty token
                    accounts, and{" "}
                    {exitReturnSolToMainWallet ? "returns" : "can return"} leftover
                    SOL to your main wallet. Jito tip is paid per bundle.
                    Estimated bundles:{" "}
                    <span className="font-mono tabular-nums">{estimatedBundles}</span>,
                    estimated total tip:{" "}
                    <span className="font-mono tabular-nums">
                      {estimatedTotalTipSol.toFixed(4)} SOL
                    </span>
                    .
                  </p>
                </div>
                {!exitFeeWaived && (
                  <div className="min-w-0 overflow-hidden rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-700 dark:text-amber-300">
                    <p className="min-w-0 wrap-break-word">
                      {exitFeeDiscounted ? (
                        <>
                          Developer active. The bundled exit fee is reduced by{" "}
                          {Math.round(exitFeeDiscountRate * 100)}% to{" "}
                          <span className="font-mono tabular-nums">
                            {exitFeeSol.toFixed(4)} SOL
                          </span>{" "}
                          after the sell bundles land successfully.
                        </>
                      ) : (
                        <>
                          A{" "}
                          <span className="font-mono tabular-nums">
                            {exitFeeSol.toFixed(1)} SOL
                          </span>{" "}
                          bundled exit fee will be deducted from your main wallet
                          after the sell bundles land successfully.
                        </>
                      )}
                    </p>
                  </div>
                )}
              </>
            )}

            {showProgress && (
              <div className="flex min-w-0 flex-col gap-4">
                <Progress value={progress} className="w-full" />
                <Separator />
                {showSummary && (
                  <div className="min-w-0 overflow-hidden rounded-md border p-3">
                    <div className="text-sm font-medium">
                      {status === "PARTIAL_SUCCESS"
                        ? "Exit completed with cleanup issues"
                        : "Exit succeeded"}
                    </div>
                    <div className="mt-2 grid min-w-0 gap-2 text-xs text-muted-foreground">
                      <div className="grid min-w-0 grid-cols-[1fr_minmax(0,1.25fr)] items-start gap-2 sm:items-center">
                        <span className="min-w-0">Total wallets</span>
                        <span className="min-w-0 text-right font-mono text-[11px] leading-snug tabular-nums sm:text-xs">
                          {summary?.totalWallets ?? "-"}
                        </span>
                      </div>
                      <div className="grid min-w-0 grid-cols-[1fr_minmax(0,1.25fr)] items-start gap-2 sm:items-center">
                        <span className="min-w-0">Bundles processed</span>
                        <span className="min-w-0 text-right font-mono text-[11px] leading-snug tabular-nums sm:text-xs">
                          {summary?.bundlesProcessed ?? "-"}
                        </span>
                      </div>
                      <div className="grid min-w-0 grid-cols-[1fr_minmax(0,1.25fr)] items-start gap-2 sm:items-center">
                        <span className="min-w-0">Chunk outcomes</span>
                        <span className="min-w-0 wrap-break-word text-right font-mono text-[11px] leading-snug sm:text-xs">
                          {summary?.successfulChunks ?? "-"} ok /{" "}
                          {summary?.failedChunks ?? "-"} failed
                        </span>
                      </div>
                      {(summary?.walletsFunded ?? 0) > 0 && (
                        <div className="grid min-w-0 grid-cols-[1fr_minmax(0,1.25fr)] items-start gap-2 sm:items-center">
                          <span className="min-w-0">Wallets funded</span>
                          <span className="min-w-0 wrap-break-word text-right font-mono text-[11px] leading-snug sm:text-xs">
                            {summary?.walletsFunded} (
                            {(
                              (summary?.fundingLamports ?? 0) / 1_000_000_000
                            ).toFixed(4)}{" "}
                            SOL)
                          </span>
                        </div>
                      )}
                      <div className="grid min-w-0 grid-cols-[1fr_minmax(0,1.25fr)] items-start gap-2 sm:items-center">
                        <span className="min-w-0">Tokens sold</span>
                        <span className="min-w-0 wrap-break-word text-right font-mono text-[11px] leading-snug sm:text-xs">
                          {summary?.totalTokensUi?.toFixed?.(4) ?? "-"}{" "}
                          {tokenSymbol}
                        </span>
                      </div>
                      <div className="grid min-w-0 grid-cols-[1fr_minmax(0,1.25fr)] items-start gap-2 sm:items-center">
                        <span className="min-w-0">ATAs closed</span>
                        <span className="min-w-0 text-right font-mono text-[11px] leading-snug tabular-nums sm:text-xs">
                          {summary?.atasClosed ?? "-"}
                        </span>
                      </div>
                      <div className="grid min-w-0 grid-cols-[1fr_minmax(0,1.25fr)] items-start gap-2 sm:items-center">
                        <span className="min-w-0">SOL recovered</span>
                        <span className="min-w-0 text-right font-mono text-[11px] leading-snug tabular-nums sm:text-xs">
                          {summary?.solRecoveredSol?.toFixed?.(4) ?? "-"} SOL
                        </span>
                      </div>
                      {(summary?.cleanupFailedWallets ?? 0) > 0 && (
                        <div className="grid min-w-0 grid-cols-[1fr_minmax(0,1.25fr)] items-start gap-2 sm:items-center">
                          <span className="min-w-0">Cleanup failures</span>
                          <span className="min-w-0 text-right font-mono text-[11px] leading-snug tabular-nums sm:text-xs">
                            {summary?.cleanupFailedWallets}
                          </span>
                        </div>
                      )}
                      {(summary?.systemDevImmediateSweeps ?? 0) > 0 && (
                        <div className="grid min-w-0 grid-cols-[1fr_minmax(0,1.25fr)] items-start gap-2 sm:items-center">
                          <span className="min-w-0">System dev sweeps</span>
                          <span className="min-w-0 wrap-break-word text-right font-mono text-[11px] leading-snug sm:text-xs">
                            {summary?.systemDevImmediateSweeps} (
                            {(
                              (summary?.systemDevImmediateSweepLamports ?? 0) /
                              1_000_000_000
                            ).toFixed(4)}{" "}
                            SOL)
                          </span>
                        </div>
                      )}
                      {(summary?.systemDevImmediateSweepFailures ?? 0) > 0 && (
                        <div className="grid min-w-0 grid-cols-[1fr_minmax(0,1.25fr)] items-start gap-2 sm:items-center">
                          <span className="min-w-0">System dev sweep failures</span>
                          <span className="min-w-0 text-right font-mono text-[11px] leading-snug tabular-nums sm:text-xs">
                            {summary?.systemDevImmediateSweepFailures}
                          </span>
                        </div>
                      )}
                      <div className="grid min-w-0 grid-cols-[1fr_minmax(0,1.25fr)] items-start gap-2 sm:items-center">
                        <span className="min-w-0">Total Jito tip</span>
                        <span className="min-w-0 text-right font-mono text-[11px] leading-snug tabular-nums sm:text-xs">
                          {summary?.totalJitoTipSol?.toFixed?.(4) ?? "-"} SOL
                        </span>
                      </div>
                      {!exitFeeWaived && (
                        <div className="grid min-w-0 grid-cols-[1fr_minmax(0,1.25fr)] items-start gap-2 sm:items-center">
                          <span className="min-w-0">Bundled exit fee</span>
                          <span className="min-w-0 text-right font-mono text-[11px] leading-snug tabular-nums sm:text-xs">
                            {summary?.exitFeeSol?.toFixed?.(4) ?? "-"} SOL
                            {summary?.exitFeeCollected === false &&
                            (summary?.exitFeeSol ?? 0) > 0
                              ? " (not collected)"
                              : ""}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                )}
                {showError && (
                  <div className="min-w-0 overflow-hidden rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm wrap-break-word text-destructive">
                    {exit?.errorMessage}
                  </div>
                )}
                {showCleanupWarning && (
                  <div className="min-w-0 overflow-hidden rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-sm wrap-break-word text-amber-700 dark:text-amber-300">
                    {exit?.errorMessage ??
                      "Some cleanup steps failed after the exit bundle succeeded."}
                  </div>
                )}
                <div className="min-w-0 overflow-hidden rounded-md border p-3 text-xs text-muted-foreground">
                  <p className="min-w-0 wrap-break-word">
                    Tip per bundle:{" "}
                    <span className="font-mono tabular-nums">
                      {activeTipSol.toFixed(4)} SOL
                    </span>
                    <br />
                    SOL return to main wallet:{" "}
                    <span className="font-mono">
                      {activeReturnSolToMainWallet ? "Enabled" : "Disabled"}
                    </span>
                    {typeof summary?.requestedReturnSolToMainWallet === "boolean" &&
                    typeof summary?.effectiveReturnSolToMainWallet === "boolean" &&
                    summary.requestedReturnSolToMainWallet !==
                      summary.effectiveReturnSolToMainWallet ? (
                      <>
                        <br />
                        <span className="font-mono">Forced on for system dev wallet handling</span>
                      </>
                    ) : null}
                  </p>
                </div>
                <div className="flex min-w-0 flex-col gap-2">
                  <div className="text-sm font-medium">Activity</div>
                  <div className="flex max-h-72 min-w-0 flex-col gap-2 overflow-y-auto overflow-x-hidden rounded-md border p-3">
                    {activityItems.length ? (
                      activityItems.map((log) => (
                        <div
                          key={log.id}
                          className={`min-w-0 rounded-md border px-3 py-2 text-sm ${
                            log.isLatest
                              ? "border-primary/40 bg-primary/5 shadow-sm"
                              : log.level === "ERROR"
                                ? "border-destructive/30 bg-destructive/5"
                                : "border-border/70"
                          }`}
                        >
                          <div className="flex min-w-0 items-start justify-between gap-3">
                            <div className="min-w-0 flex-1">
                              <div
                                className={`wrap-break-word ${
                                  log.isLatest
                                    ? "font-medium text-foreground"
                                    : "text-foreground"
                                }`}
                              >
                                {log.message}
                              </div>
                              <div className="mt-1 flex flex-wrap items-center gap-2">
                                <Badge
                                  variant={
                                    log.level === "ERROR"
                                      ? "destructive"
                                      : "secondary"
                                  }
                                >
                                  {log.level}
                                </Badge>
                                {log.step ? (
                                  <div className="text-xs text-muted-foreground wrap-break-word">
                                    {log.step}
                                  </div>
                                ) : null}
                              </div>
                            </div>
                            <div className="shrink-0 text-xs text-muted-foreground">
                              {new Date(log.createdAt).toLocaleTimeString()}
                            </div>
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
              </div>
            )}
          </TabsContent>
        </Tabs>
        </div>

        <DialogFooter className="mx-0 mb-0 min-w-0 flex-wrap items-center rounded-b-xl border-t px-4 py-3 sm:items-center sm:justify-end sm:gap-2">
          {activeTab === "exit" ? (
            <>
              <div className="flex min-w-0 flex-wrap items-center gap-1.5 text-sm text-muted-foreground sm:mr-auto">
                <span className="min-w-0 wrap-break-word">
                  Powered by{" "}
                  <a
                    href="https://www.jito.wtf/"
                    target="_blank"
                    rel="noreferrer"
                    className="underline underline-offset-4 transition-colors hover:text-foreground"
                  >
                    Jito
                  </a>
                </span>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      className="inline-flex text-muted-foreground transition-colors hover:text-foreground"
                      aria-label="About Jito bundles"
                    >
                      <Info className="size-3.5" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="max-w-sm">
                    Exit submits the sell flow as Jito bundles so grouped
                    instructions can land together with priority.
                  </TooltipContent>
                </Tooltip>
              </div>
              {showProgress ? (
                <div className="flex w-full min-w-0 flex-wrap justify-end gap-2 sm:w-auto">
                  {(status === "PENDING" || status === "RUNNING") &&
                    onCancelExit && (
                      <Button
                        variant="destructive"
                        onClick={onCancelExit}
                        disabled={isCancellingExit}
                      >
                        {isCancellingExit ? (
                          <>
                            <Spinner className="mr-2 size-4" />
                            Cancelling...
                          </>
                        ) : (
                          "Cancel Exit"
                        )}
                      </Button>
                    )}
                  <Button
                    variant="outline"
                    onClick={() => onOpenChange(false)}
                    disabled={!canClose && !isCancellingExit}
                  >
                    Close
                  </Button>
                </div>
              ) : (
                <>
                  <Button
                    variant="outline"
                    onClick={() => onOpenChange(false)}
                    disabled={isStartingExit}
                  >
                    Cancel
                  </Button>
                  <Button
                    variant="destructive"
                    onClick={handleExitClick}
                    disabled={isStartingExit}
                  >
                    {isStartingExit ? (
                      <>
                        <Spinner className="mr-2 size-4" />
                        Starting...
                      </>
                    ) : (
                      "Exit"
                    )}
                  </Button>
                </>
              )}
            </>
          ) : (
            <>
              <Button
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={isSelling}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={handleSellConfirm}
                disabled={
                  isSelling || isPreparingSell || selectedSellHoldings.length === 0
                }
              >
                {isSelling ? "Selling..." : "Sell"}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
    <AlertDialog open={exitConfirmOpen} onOpenChange={setExitConfirmOpen}>
      <AlertDialogContent size="default">
        <AlertDialogHeader>
          <AlertDialogTitle>Confirm bundled exit</AlertDialogTitle>
          <AlertDialogDescription>
            This will sell token balances across all managed wallets for{" "}
            <span className="font-mono">${tokenSymbol}</span>. Estimated bundles:{" "}
            <span className="font-mono tabular-nums">{estimatedBundles}</span>,
            estimated total Jito tip:{" "}
            <span className="font-mono tabular-nums">
              {estimatedTotalTipSol.toFixed(4)} SOL
            </span>
            .
            {!exitFeeWaived && (
              <>
                {" "}
                {exitFeeDiscounted ? (
                  <>
                    Developer active. The bundled exit fee is reduced by{" "}
                    {Math.round(exitFeeDiscountRate * 100)}% to{" "}
                    <span className="font-mono tabular-nums">
                      {exitFeeSol.toFixed(4)} SOL
                    </span>{" "}
                    after the sell bundles land successfully.
                  </>
                ) : (
                  <>
                    A{" "}
                    <span className="font-mono tabular-nums">
                      {exitFeeSol.toFixed(1)} SOL
                    </span>{" "}
                    bundled exit fee will be deducted from your main wallet after
                    the sell bundles land successfully.
                  </>
                )}
              </>
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isStartingExit}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={isStartingExit}
            onClick={(event) => {
              event.preventDefault();
              void handleExitConfirm();
            }}
          >
            {isStartingExit ? "Starting..." : "Confirm Exit"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    </>
  );
}
