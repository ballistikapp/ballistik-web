"use client";

import * as React from "react";
import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc/client";
import { DEVELOPER_FEE_DISCOUNT_RATE } from "@/lib/config/subscription.config";
import { generatedWalletFeeSol } from "@/lib/config/usage-fees.config";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
import { Spinner } from "@/components/ui/spinner";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

type BuyWalletSummary = {
  publicKey: string;
  balanceSol: number | null;
  type: string;
};

type HoldingBuyDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tokenPublicKey: string;
  tokenSymbol: string;
  isBuying?: boolean;
  onBuy: (
    walletPublicKeys: string[],
    solAmountPerWallet: number,
    slippageBps: number
  ) => Promise<void>;
};

const DEFAULT_SLIPPAGE_BPS = 500;
const BUY_WALLET_PAGE_SIZE = 200;
const BUY_EXTRA_FEE_RESERVE_BPS = 200;
const BUY_MIN_EXTRA_FEE_RESERVE_SOL = 0.002;
const BUY_WALLET_RENT_RESERVE_SOL = 0.001;
const BUYER_WALLET_MAX_CREATE_COUNT = 50;

function getBuyReserveSol(solAmountPerWallet: number) {
  return Math.max(
    (solAmountPerWallet * BUY_EXTRA_FEE_RESERVE_BPS) / 10_000,
    BUY_MIN_EXTRA_FEE_RESERVE_SOL
  );
}

function dedupeWallets(wallets: BuyWalletSummary[]) {
  return Array.from(
    new Map(wallets.map((wallet) => [wallet.publicKey, wallet])).values()
  );
}

function formatWalletType(type: string) {
  return type.replaceAll("_", " ").toLowerCase();
}

function shortenPublicKey(publicKey: string) {
  return `${publicKey.slice(0, 4)}...${publicKey.slice(-4)}`;
}

function formatSolAmount(value: number) {
  return value >= 0.01 ? value.toFixed(4) : value.toFixed(6);
}

function getPlanDiscountRate(plan: string | undefined) {
  if (plan === "PRO") return 1;
  if (plan === "DEVELOPER") return DEVELOPER_FEE_DISCOUNT_RATE;
  return 0;
}

export function HoldingBuyDialog({
  open,
  onOpenChange,
  tokenPublicKey,
  tokenSymbol,
  isBuying = false,
  onBuy,
}: HoldingBuyDialogProps) {
  const [solAmount, setSolAmount] = React.useState("0.01");
  const [slippageBps, setSlippageBps] = React.useState(
    String(DEFAULT_SLIPPAGE_BPS)
  );
  const [selectedWallets, setSelectedWallets] = React.useState<
    Record<string, boolean>
  >({});
  const [buyerWalletCount, setBuyerWalletCount] = React.useState("1");
  const utils = trpc.useUtils();

  const operationalWalletsQuery = trpc.wallet.getOperationalByToken.useQuery(
    {
      tokenPublicKey,
      page: 1,
      pageSize: BUY_WALLET_PAGE_SIZE,
    },
    { enabled: open && Boolean(tokenPublicKey) }
  );
  const devWalletQuery = trpc.wallet.getDevByToken.useQuery(
    { tokenPublicKey },
    { enabled: open && Boolean(tokenPublicKey) }
  );
  const mainWalletQuery = trpc.wallet.getMain.useQuery(
    {},
    { enabled: open && Boolean(tokenPublicKey) }
  );
  const authQuery = trpc.auth.me.useQuery(undefined, {
    enabled: open,
  });
  const createBuyerWallets = trpc.wallet.createBuyerByToken.useMutation();

  const wallets = React.useMemo(
    () =>
      dedupeWallets([
        ...(devWalletQuery.data
          ? [
              {
                publicKey: devWalletQuery.data.publicKey,
                balanceSol:
                  typeof devWalletQuery.data.balanceSol === "number"
                    ? devWalletQuery.data.balanceSol
                    : Number(devWalletQuery.data.balanceSol ?? 0),
                type: devWalletQuery.data.type,
              },
            ]
          : []),
        ...(operationalWalletsQuery.data?.wallets.map((wallet) => ({
          publicKey: wallet.publicKey,
          balanceSol:
            typeof wallet.balanceSol === "number"
              ? wallet.balanceSol
              : Number(wallet.balanceSol ?? 0),
          type: wallet.type,
        })) ?? []),
      ]),
    [devWalletQuery.data, operationalWalletsQuery.data?.wallets]
  );
  const isLoadingWallets =
    operationalWalletsQuery.isLoading ||
    devWalletQuery.isLoading ||
    mainWalletQuery.isLoading;

  React.useEffect(() => {
    if (!open || isLoadingWallets || wallets.length === 0) return;
    setSelectedWallets((current) => {
      const currentKeys = Object.keys(current);
      if (currentKeys.length > 0) return current;
      return Object.fromEntries(
        wallets.map((wallet) => [wallet.publicKey, wallet.type === "DEV"])
      );
    });
  }, [isLoadingWallets, open, wallets]);

  React.useEffect(() => {
    if (open) return;
    setSolAmount("0.01");
    setSlippageBps(String(DEFAULT_SLIPPAGE_BPS));
    setSelectedWallets({});
    setBuyerWalletCount("1");
  }, [open]);

  const parsedSolAmount = Number.parseFloat(solAmount);
  const parsedSlippageBps = Number.parseInt(slippageBps, 10);
  const parsedBuyerWalletCount = Number.parseInt(buyerWalletCount, 10);
  const buyerWalletCountIsValid =
    Number.isInteger(parsedBuyerWalletCount) &&
    parsedBuyerWalletCount >= 1 &&
    parsedBuyerWalletCount <= BUYER_WALLET_MAX_CREATE_COUNT;
  const platformFeeDiscountRate = getPlanDiscountRate(authQuery.data?.plan);
  const nominalBuyerWalletFeeSol = buyerWalletCountIsValid
    ? parsedBuyerWalletCount * generatedWalletFeeSol
    : 0;
  const buyerWalletGenerationFeeIsWaived = platformFeeDiscountRate >= 1;
  const chargedBuyerWalletFeeSol =
    buyerWalletGenerationFeeIsWaived
      ? 0
      : nominalBuyerWalletFeeSol * (1 - platformFeeDiscountRate);
  const generateFeeLabel = `${formatSolAmount(chargedBuyerWalletFeeSol)} SOL`;
  const selectedBuyWallets = React.useMemo(
    () => wallets.filter((wallet) => selectedWallets[wallet.publicKey]),
    [selectedWallets, wallets]
  );
  const totalBuySol =
    Number.isFinite(parsedSolAmount) && parsedSolAmount > 0
      ? parsedSolAmount * selectedBuyWallets.length
      : 0;
  const estimatedTopUpSol =
    Number.isFinite(parsedSolAmount) && parsedSolAmount > 0
      ? selectedBuyWallets.reduce((sum, wallet) => {
          const currentBalance = wallet.balanceSol ?? 0;
          const required =
            parsedSolAmount +
            getBuyReserveSol(parsedSolAmount) +
            BUY_WALLET_RENT_RESERVE_SOL;
          const deficit = required - currentBalance;
          return deficit > 0 ? sum + deficit : sum;
        }, 0)
      : 0;
  const mainBalanceSol = mainWalletQuery.data
    ? Number(mainWalletQuery.data.balanceSol ?? 0)
    : 0;
  const mainWalletInsufficient =
    estimatedTopUpSol > 0 && mainBalanceSol < estimatedTopUpSol;
  const selectedWalletLabel = `${selectedBuyWallets.length} / ${wallets.length}`;

  const setAllWallets = (checked: boolean) => {
    setSelectedWallets(
      Object.fromEntries(wallets.map((wallet) => [wallet.publicKey, checked]))
    );
  };

  const handleGenerateBuyerWallets = async () => {
    if (!buyerWalletCountIsValid) {
      toast.error(
        `Enter a wallet count between 1 and ${BUYER_WALLET_MAX_CREATE_COUNT}`
      );
      return;
    }

    try {
      const result = await createBuyerWallets.mutateAsync({
        tokenPublicKey,
        count: parsedBuyerWalletCount,
      });
      const createdPublicKeys = result.wallets.map((wallet) => wallet.publicKey);
      setSelectedWallets((current) => ({
        ...current,
        ...Object.fromEntries(
          createdPublicKeys.map((publicKey) => [publicKey, true])
        ),
      }));
      await Promise.all([
        operationalWalletsQuery.refetch(),
        mainWalletQuery.refetch(),
        utils.wallet.getOperationalByToken.invalidate({ tokenPublicKey }),
        utils.wallet.getMain.invalidate(),
      ]);
      toast.success(
        `Generated ${createdPublicKeys.length} buyer wallet${createdPublicKeys.length === 1 ? "" : "s"}`
      );
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Failed to generate buyer wallets";
      toast.error(message);
    }
  };

  const handleConfirm = async () => {
    if (
      !Number.isFinite(parsedSolAmount) ||
      parsedSolAmount <= 0 ||
      parsedSolAmount > 10
    ) {
      toast.error("Enter a SOL amount between 0.001 and 10");
      return;
    }
    if (
      !Number.isFinite(parsedSlippageBps) ||
      parsedSlippageBps < 0 ||
      parsedSlippageBps > 10_000
    ) {
      toast.error("Enter slippage between 0 and 10000 bps");
      return;
    }
    const walletPublicKeys = selectedBuyWallets.map(
      (wallet) => wallet.publicKey
    );
    if (walletPublicKeys.length === 0) {
      toast.error("Select at least one wallet");
      return;
    }
    if (mainWalletInsufficient) {
      toast.error("Main wallet has insufficient SOL for estimated top-ups");
      return;
    }
    await onBuy(walletPublicKeys, parsedSolAmount, parsedSlippageBps);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="grid max-h-[min(90vh,760px)] max-w-lg grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden p-0 sm:max-w-lg">
        <DialogHeader className="border-b px-4 py-3 pr-12">
          <DialogTitle className="flex items-center gap-2">
            BUY
            <Badge variant="secondary" className="text-xs font-mono">
              ${tokenSymbol}
            </Badge>
          </DialogTitle>
        </DialogHeader>

        <div className="min-h-0 overflow-y-auto px-4 py-3">
          <div className="flex flex-col gap-3">
            <div className="grid grid-cols-3 gap-2">
              <div className="rounded-md border p-2">
                <div className="text-[11px] text-muted-foreground">Wallets</div>
                <div className="mt-1 font-mono text-sm">
                  {selectedWalletLabel}
                </div>
              </div>
              <div className="rounded-md border p-2">
                <div className="text-[11px] text-muted-foreground">
                  Buy total
                </div>
                <div className="mt-1 font-mono text-sm">
                  {formatSolAmount(totalBuySol)} SOL
                </div>
              </div>
              <div className="rounded-md border p-2">
                <div className="text-[11px] text-muted-foreground">Top-up</div>
                <div className="mt-1 font-mono text-sm">
                  {formatSolAmount(estimatedTopUpSol)} SOL
                </div>
              </div>
            </div>

            <div className="rounded-md border">
              <div className="flex items-center justify-between gap-3 border-b px-3 py-2">
                <div className="min-w-0">
                  <div className="text-sm font-medium">Buying wallets</div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setAllWallets(false)}
                    disabled={isLoadingWallets || wallets.length === 0}
                  >
                    Clear
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setAllWallets(true)}
                    disabled={isLoadingWallets || wallets.length === 0}
                  >
                    All
                  </Button>
                </div>
              </div>
              <Accordion
                type="single"
                collapsible
                className="border-b bg-muted/20"
              >
                <AccordionItem value="wallet-generation" className="border-b-0">
                  <AccordionTrigger className="rounded-none px-3 py-2 hover:no-underline">
                    <span className="flex min-w-0 flex-col gap-0.5">
                      <span>Generate buyer wallets</span>
                      {buyerWalletGenerationFeeIsWaived ? null : (
                        <span className="text-xs font-normal text-muted-foreground">
                          {formatSolAmount(generatedWalletFeeSol)} SOL each ·
                          fee{" "}
                          <span className="font-mono">{generateFeeLabel}</span>
                        </span>
                      )}
                    </span>
                  </AccordionTrigger>
                  <AccordionContent className="px-3 pb-3">
                    <div className="grid gap-2 sm:grid-cols-[1fr_auto] sm:items-end">
                      <div className="grid gap-1.5">
                        <Label htmlFor="buyerWalletCount" className="text-xs">
                          Wallet count
                        </Label>
                        <Input
                          id="buyerWalletCount"
                          type="number"
                          min="1"
                          max={BUYER_WALLET_MAX_CREATE_COUNT}
                          step="1"
                          value={buyerWalletCount}
                          onChange={(event) =>
                            setBuyerWalletCount(event.target.value)
                          }
                          className="h-8 w-24"
                          disabled={isBuying || createBuyerWallets.isPending}
                        />
                        {platformFeeDiscountRate > 0 &&
                        !buyerWalletGenerationFeeIsWaived ? (
                          <p className="text-[11px] text-muted-foreground">
                            Developer plan applies a{" "}
                            {Math.round(platformFeeDiscountRate * 100)}%
                            platform-fee discount.
                          </p>
                        ) : null}
                      </div>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={
                              isBuying ||
                              createBuyerWallets.isPending ||
                              !buyerWalletCountIsValid ||
                              !tokenPublicKey
                            }
                          >
                            {createBuyerWallets.isPending
                              ? "Generating..."
                              : "Generate"}
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent size="sm">
                          <AlertDialogHeader>
                            <AlertDialogTitle>
                              Generate buyer wallets?
                            </AlertDialogTitle>
                            <AlertDialogDescription>
                              {`This will generate ${parsedBuyerWalletCount} buyer wallet${parsedBuyerWalletCount === 1 ? "" : "s"} for `}
                              <span className="font-mono">
                                ${tokenSymbol}
                              </span>
                              .
                              {buyerWalletGenerationFeeIsWaived ? null : (
                                <>
                                  {" "}
                                  Platform fee:{" "}
                                  <span className="font-mono">
                                    {generateFeeLabel}
                                  </span>
                                  .
                                </>
                              )}
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction
                              onClick={handleGenerateBuyerWallets}
                            >
                              Generate
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  </AccordionContent>
                </AccordionItem>
              </Accordion>
              <div className="max-h-[34vh] min-h-28 overflow-y-auto p-1.5">
                {isLoadingWallets ? (
                  <div className="flex items-center justify-center gap-2 p-6 text-sm text-muted-foreground">
                    <Spinner className="size-4" />
                    Loading wallets...
                  </div>
                ) : wallets.length === 0 ? (
                  <div className="p-6 text-center text-sm text-muted-foreground">
                    No eligible wallets found.
                  </div>
                ) : (
                  <div className="flex flex-col gap-1">
                    {wallets.map((wallet) => (
                      <label
                        key={wallet.publicKey}
                        className="grid cursor-default [grid-template-columns:1.25rem_max-content_minmax(0,1fr)_minmax(4.5rem,auto)] items-center gap-x-2 gap-y-0 rounded-md px-2 py-1.5 hover:bg-muted/50"
                      >
                        <Checkbox
                          checked={Boolean(selectedWallets[wallet.publicKey])}
                          onCheckedChange={(value) =>
                            setSelectedWallets((current) => ({
                              ...current,
                              [wallet.publicKey]: Boolean(value),
                            }))
                          }
                        />
                        <Badge
                          variant="secondary"
                          className="h-4 w-fit shrink-0 justify-self-start px-1.5 text-[10px] uppercase"
                        >
                          {formatWalletType(wallet.type)}
                        </Badge>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Link
                              href={`/${tokenPublicKey}/wallets/${wallet.publicKey}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="group inline-flex w-fit min-w-0 max-w-full cursor-pointer items-center gap-1 justify-self-start font-mono text-xs no-underline"
                              aria-label="Go to wallet"
                              onClick={(event) => event.stopPropagation()}
                            >
                              <span className="underline-offset-2 group-hover:underline">
                                {shortenPublicKey(wallet.publicKey)}
                              </span>
                              <ExternalLink
                                className="size-3 shrink-0 text-muted-foreground opacity-80"
                                aria-hidden
                              />
                            </Link>
                          </TooltipTrigger>
                          <TooltipContent side="top">
                            Go to wallet
                          </TooltipContent>
                        </Tooltip>
                        <span className="text-right font-mono text-xs tabular-nums text-muted-foreground">
                          {formatSolAmount(wallet.balanceSol ?? 0)} SOL
                        </span>
                      </label>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="grid gap-1.5">
              <div className="grid gap-1.5">
                <Label htmlFor="buySolAmount">SOL per wallet</Label>
                <Input
                  id="buySolAmount"
                  type="number"
                  min="0.001"
                  max="10"
                  step="0.001"
                  value={solAmount}
                  onChange={(event) => setSolAmount(event.target.value)}
                />
              </div>
            </div>

            <Accordion type="single" collapsible>
              <AccordionItem value="advanced">
                <AccordionTrigger>Advanced settings</AccordionTrigger>
                <AccordionContent className="flex flex-col gap-2">
                  <Label htmlFor="buySlippageBps">Slippage (bps)</Label>
                  <Input
                    id="buySlippageBps"
                    type="number"
                    min="0"
                    max="10000"
                    step="50"
                    value={slippageBps}
                    onChange={(event) => setSlippageBps(event.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">
                    500 bps = 5%. Higher slippage increases fill tolerance.
                  </p>
                </AccordionContent>
              </AccordionItem>
            </Accordion>

            {mainWalletInsufficient ? (
              <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                Main wallet balance is below the estimated top-up requirement.
              </div>
            ) : null}
          </div>
        </div>

        <DialogFooter className="mx-0 mb-0 items-center rounded-b-xl px-4 py-3">
          <div className="text-xs text-muted-foreground sm:mr-auto">
            Excess funds resulting from top-ups will be returned to the main
            wallet.
          </div>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isBuying}
          >
            Cancel
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={
              isBuying ||
              isLoadingWallets ||
              selectedBuyWallets.length === 0 ||
              mainWalletInsufficient
            }
          >
            {isBuying ? "Buying..." : "Buy"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
