"use client";

import Image from "next/image";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  IconArrowDownRight,
  IconArrowUpRight,
  IconCopy,
  IconEye,
  IconRefresh,
} from "@tabler/icons-react";
import Link from "next/link";
import { trpc } from "@/lib/trpc/client";
import { cacheConfig } from "@/lib/config/cache.config";
import { formatRefreshTime } from "@/lib/utils/relative-time";
import { copyToClipboard } from "@/lib/utils";
import { TokenNotFound } from "@/components/placeholders/token-not-found";
import { DashboardLoading } from "../dashboard/dashboard-loading";
import {
  DataTable,
  DataTablePagination,
  DataTableViewOptions,
  DataTableSearch,
} from "@/components/data-table";
import { getColumns } from "./columns";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/layout/sections";
import { WalletTransferDialog } from "@/components/wallets/wallet-transfer-dialog";
import { Spinner } from "@/components/ui/spinner";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

type RefreshedWallet = {
  publicKey: string;
  balanceSol: number;
  balanceRefreshedAt: Date | string;
};

const SHARED_MAIN_DEV_LABEL = "Main Wallet (used as dev)";

export default function Page() {
  const { tokenPublicKey } = useParams<{ tokenPublicKey: string }>();
  const utils = trpc.useUtils();
  const [rowSelection, setRowSelection] = useState<Record<string, boolean>>({});
  const [sendDialogOpen, setSendDialogOpen] = useState(false);
  const [returnDialogOpen, setReturnDialogOpen] = useState(false);
  const [sendTargets, setSendTargets] = useState<string[]>([]);
  const [returnTargets, setReturnTargets] = useState<string[]>([]);

  const {
    data: tokenData,
    isLoading: tokenLoading,
    error: tokenError,
    refetch: refetchToken,
  } = trpc.token.getByPublicKey.useQuery(
    { publicKey: tokenPublicKey || "" },
    { enabled: !!tokenPublicKey }
  );

  const { data: operationalWalletsData, isLoading: operationalWalletsLoading } =
    trpc.wallet.getOperationalByToken.useQuery(
      { tokenPublicKey: tokenPublicKey || "" },
      {
        enabled: !!tokenPublicKey && !!tokenData,
        staleTime: cacheConfig.staleMs.wallets,
      }
    );

  const { data: devWallet, isLoading: devWalletLoading } =
    trpc.wallet.getDevByToken.useQuery(
      { tokenPublicKey: tokenPublicKey || "" },
      {
        enabled: !!tokenPublicKey && !!tokenData,
        staleTime: cacheConfig.staleMs.wallets,
      }
    );

  const { data: mainWallet, isLoading: mainWalletLoading } =
    trpc.wallet.getMain.useQuery(
      {},
      { enabled: !!tokenData, staleTime: cacheConfig.staleMs.wallets }
    );

  const { data: refreshCache, isLoading: refreshCacheLoading } =
    trpc.refreshCache.getByScope.useQuery(
      {
        tokenPublicKey: tokenPublicKey || "",
        scope: "WALLETS",
      },
      { enabled: !!tokenPublicKey }
    );

  const { mutateAsync: refreshBalances, isPending: isRefreshingBalances } =
    trpc.wallet.refreshBalances.useMutation();

  const wallets = useMemo(
    () => operationalWalletsData?.wallets ?? [],
    [operationalWalletsData?.wallets]
  );
  const isSystemDevWallet = Boolean(
    devWallet && "isSystemWallet" in devWallet && devWallet.isSystemWallet
  );
  const custodyDevWallet = isSystemDevWallet ? null : devWallet;
  const displayDevWallet = devWallet;
  const isSharedMainDevWallet = Boolean(
    mainWallet &&
      custodyDevWallet &&
      mainWallet.publicKey === custodyDevWallet.publicKey
  );
  const sharedWallet = isSharedMainDevWallet ? mainWallet ?? custodyDevWallet : null;
  const allWallets = useMemo(
    () =>
      Array.from(
        new Map(
          [
            ...(mainWallet ? [mainWallet] : []),
            ...(custodyDevWallet ? [custodyDevWallet] : []),
            ...wallets,
          ].map((wallet) => [wallet.publicKey, wallet])
        ).values()
      ),
    [custodyDevWallet, mainWallet, wallets]
  );
  const totalSolBalance = useMemo(
    () =>
      allWallets.reduce(
        (sum, wallet) => sum + Number(wallet.balanceSol ?? 0),
        0
      ),
    [allWallets]
  );

  const getCooldownMessage = useCallback(
    (walletPublicKeys?: string[]) => {
      const now = Date.now();
      const targetWallets = walletPublicKeys?.length
        ? allWallets.filter((wallet) =>
            walletPublicKeys.includes(wallet.publicKey)
          )
        : allWallets;
      const remaining = targetWallets
        .map((wallet) => {
          if (!wallet.balanceRefreshedAt) return 0;
          const last = new Date(wallet.balanceRefreshedAt).getTime();
          return Math.max(
            0,
            cacheConfig.cooldownMs.walletBalances - (now - last)
          );
        })
        .filter((value) => value > 0);

      if (remaining.length === 0) {
        return "Wallet balances were refreshed recently.";
      }

      const waitSeconds = Math.max(1, Math.ceil(Math.min(...remaining) / 1000));
      return `Wallet balances were refreshed recently. Try again in ${waitSeconds}s.`;
    },
    [allWallets]
  );

  const applyRefreshedWalletsToCache = useCallback(
    (refreshed: RefreshedWallet[]) => {
      if (!tokenPublicKey || refreshed.length === 0) return 0;
      const byPublicKey = new Map(
        refreshed.map((wallet) => [wallet.publicKey, wallet])
      );
      let matchedCount = 0;
      utils.wallet.getOperationalByToken.setData(
        { tokenPublicKey },
        (current) => {
          if (!current) return current;
          return {
            ...current,
            wallets: current.wallets.map((wallet) => {
              const next = byPublicKey.get(wallet.publicKey);
              if (!next) return wallet;
              matchedCount += 1;
              return {
                ...wallet,
                balanceSol: next.balanceSol as never,
                balanceRefreshedAt: new Date(next.balanceRefreshedAt),
              };
            }),
          };
        }
      );
      utils.wallet.getDevByToken.setData({ tokenPublicKey }, (current) => {
        if (!current) return current;
        const next = byPublicKey.get(current.publicKey);
        if (!next) return current;
        matchedCount += 1;
        return {
          ...current,
          balanceSol: next.balanceSol as never,
          balanceRefreshedAt: new Date(next.balanceRefreshedAt),
        };
      });
      utils.wallet.getMain.setData({}, (current) => {
        if (!current) return current;
        const next = byPublicKey.get(current.publicKey);
        if (!next) return current;
        matchedCount += 1;
        return {
          ...current,
          balanceSol: next.balanceSol as never,
          balanceRefreshedAt: new Date(next.balanceRefreshedAt),
        };
      });
      return matchedCount;
    },
    [
      tokenPublicKey,
      utils.wallet.getDevByToken,
      utils.wallet.getMain,
      utils.wallet.getOperationalByToken,
    ]
  );

  const handleRefreshBalances = useCallback(
    async (walletPublicKeys?: string[], options?: { showToast?: boolean }) => {
      if (!tokenPublicKey) return;
      const showToast = options?.showToast !== false;
      const targeted = Boolean(walletPublicKeys?.length);
      const toastId = showToast
        ? toast.loading("Refreshing wallet balances...", {
            icon: <Spinner className="size-4" />,
          })
        : null;

      try {
        const result = await refreshBalances({
          tokenPublicKey,
          walletPublicKeys,
        });
        const refreshed = result.refreshed;
        if (targeted) {
          const patchedCount = applyRefreshedWalletsToCache(refreshed);
          const patchMiss = refreshed.length > 0 && patchedCount === 0;
          if (patchMiss) {
            await Promise.all([
              utils.wallet.getOperationalByToken.invalidate({ tokenPublicKey }),
              utils.wallet.getDevByToken.invalidate({ tokenPublicKey }),
              utils.wallet.getMain.invalidate(),
            ]);
          }
          await utils.refreshCache.getByScope.invalidate({
            tokenPublicKey,
            scope: "WALLETS",
          });
        } else {
          await Promise.all([
            utils.wallet.getOperationalByToken.invalidate({ tokenPublicKey }),
            utils.wallet.getDevByToken.invalidate({ tokenPublicKey }),
            utils.wallet.getMain.invalidate(),
            utils.refreshCache.getByScope.invalidate({
              tokenPublicKey,
              scope: "WALLETS",
            }),
          ]);
        }
        if (toastId) {
          if (refreshed.length > 0) {
            const parts: string[] = [];
            parts.push(
              `Refreshed ${refreshed.length} wallet${refreshed.length === 1 ? "" : "s"}`
            );
            if (result.skippedCooldown.length > 0) {
              parts.push(`${result.skippedCooldown.length} on cooldown`);
            }
            if (result.skippedNotAllowed.length > 0) {
              parts.push(`${result.skippedNotAllowed.length} not allowed`);
            }
            toast.success("Wallet balances refreshed", {
              id: toastId,
              description: parts.join(", "),
              icon: null,
            });
          } else if (result.skippedCooldown.length > 0) {
            toast.info(getCooldownMessage(walletPublicKeys), {
              id: toastId,
              icon: null,
            });
          } else if (result.skippedNotAllowed.length > 0) {
            toast.info("Requested wallets are not available for this token", {
              id: toastId,
              icon: null,
            });
          } else {
            toast.info("No wallets were refreshed", {
              id: toastId,
              icon: null,
            });
          }
        }
      } catch {
        if (toastId) {
          toast.error("Failed to refresh wallet balances", {
            id: toastId,
            icon: null,
          });
        }
      }
    },
    [
      utils,
      getCooldownMessage,
      refreshBalances,
      tokenPublicKey,
      applyRefreshedWalletsToCache,
    ]
  );

  const handleOpenSend = useCallback((walletPublicKeys: string[]) => {
    setSendTargets(walletPublicKeys);
    setSendDialogOpen(true);
  }, []);

  const handleOpenReturn = useCallback((walletPublicKeys: string[]) => {
    setReturnTargets(walletPublicKeys);
    setReturnDialogOpen(true);
  }, []);

  const selectedWalletPublicKeys = useMemo(() => {
    const wallets = operationalWalletsData?.wallets ?? [];
    return wallets
      .filter((wallet: { publicKey: string }) => rowSelection[wallet.publicKey])
      .map((wallet: { publicKey: string }) => wallet.publicKey);
  }, [rowSelection, operationalWalletsData?.wallets]);

  const transferWallets = useMemo(
    () =>
      allWallets.map((wallet) => ({
        publicKey: wallet.publicKey,
        type: wallet.type,
        balanceSol:
          wallet.balanceSol == null ? null : Number(wallet.balanceSol),
      })),
    [allWallets]
  );

  const columns = useMemo(() => {
    if (!tokenPublicKey) return [];
    return getColumns({
      tokenPublicKey,
      onRefresh: (walletPublicKey) => handleRefreshBalances([walletPublicKey]),
      onSend: (walletPublicKey) => handleOpenSend([walletPublicKey]),
      onReturn: (walletPublicKey) => handleOpenReturn([walletPublicKey]),
    });
  }, [handleOpenReturn, handleOpenSend, handleRefreshBalances, tokenPublicKey]);

  const refreshTimestamp = refreshCache?.lastRefreshedAt ?? null;
  const autoRefreshTriggered = useRef(false);

  useEffect(() => {
    if (!tokenPublicKey || !tokenData) return;
    if (refreshCacheLoading) return;
    if (isRefreshingBalances) return;
    const isStale =
      !refreshTimestamp ||
      Date.now() - new Date(refreshTimestamp).getTime() >=
        cacheConfig.staleMs.wallets;
    if (!isStale) return;
    if (autoRefreshTriggered.current) return;
    autoRefreshTriggered.current = true;
    void handleRefreshBalances(undefined, { showToast: false });
  }, [
    handleRefreshBalances,
    isRefreshingBalances,
    refreshCacheLoading,
    refreshTimestamp,
    tokenData,
    tokenPublicKey,
  ]);

  if (tokenLoading) {
    return <DashboardLoading />;
  }

  if (!tokenData) {
    return (
      <TokenNotFound
        error={tokenError as Error | null}
        onRetry={() => refetchToken()}
      />
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Wallets"
        rightContent={
          <div className="flex w-full flex-col items-start gap-3 md:items-end md:gap-4">
            <div className="text-left md:text-right">
              <p className="text-xs uppercase tracking-tighter font-mono font-semibold text-muted-foreground">
                TOTAL BALANCE
              </p>
              <p className="font-mono leading-none">
                <span className="text-2xl md:text-4xl">
                  {totalSolBalance.toFixed(4)}
                </span>{" "}
                <span className="text-base text-muted-foreground">SOL</span>
              </p>
            </div>
            <div className="flex w-full flex-wrap items-center gap-2 md:w-auto md:justify-end md:gap-3">
              <p className="text-sm text-muted-foreground">
                Last refresh: {formatRefreshTime(refreshTimestamp)}
              </p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleRefreshBalances()}
                disabled={isRefreshingBalances || !tokenPublicKey}
              >
                {isRefreshingBalances ? (
                  <Spinner className="mr-2 size-4" />
                ) : (
                  <IconRefresh className="mr-2 size-4" />
                )}
                Refresh
              </Button>
            </div>
          </div>
        }
      />

      <div
        className={`grid gap-4 pt-6 ${isSharedMainDevWallet ? "md:grid-cols-1" : "md:grid-cols-2"}`}
      >
        {isSharedMainDevWallet ? (
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>{SHARED_MAIN_DEV_LABEL}</CardTitle>
              <Badge variant="default">Main + Dev</Badge>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <div className="flex items-start gap-1">
                <div className="break-all font-mono text-xs text-muted-foreground sm:text-sm">
                  {sharedWallet?.publicKey || "Not available"}
                </div>
                {sharedWallet && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="text-muted-foreground hover:text-foreground size-7"
                        onClick={() =>
                          void copyToClipboard(
                            sharedWallet.publicKey,
                            "Shared wallet public key"
                          )
                        }
                      >
                        <IconCopy className="size-3.5" />
                        <span className="sr-only">
                          Copy shared wallet public key
                        </span>
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Copy public key</TooltipContent>
                  </Tooltip>
                )}
              </div>
              <div className="flex flex-col gap-2">
                <div className="text-2xl font-mono">
                  {Number(sharedWallet?.balanceSol ?? 0).toFixed(4)} SOL
                </div>
                <div className="text-xs text-muted-foreground">
                  Last refreshed{" "}
                  {formatRefreshTime(sharedWallet?.balanceRefreshedAt)}
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={() =>
                        sharedWallet &&
                        handleRefreshBalances([sharedWallet.publicKey])
                      }
                      disabled={isRefreshingBalances || !sharedWallet}
                    >
                      {isRefreshingBalances ? (
                        <Spinner className="size-4" />
                      ) : (
                        <IconRefresh className="size-4" />
                      )}
                      <span className="sr-only">Refresh shared wallet</span>
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Refresh</TooltipContent>
                </Tooltip>
                {sharedWallet && tokenPublicKey && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button variant="outline" size="icon" asChild>
                        <Link
                          href={`/${tokenPublicKey}/wallets/${sharedWallet.publicKey}`}
                        >
                          <IconEye className="size-4" />
                          <span className="sr-only">View shared wallet</span>
                        </Link>
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>View wallet</TooltipContent>
                  </Tooltip>
                )}
                {sharedWallet && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button variant="outline" size="icon" asChild>
                        <a
                          href={`https://solscan.io/account/${sharedWallet.publicKey}`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          <Image
                            src="/logos/solscan-logo-dark.svg"
                            alt=""
                            aria-hidden="true"
                            width={16}
                            height={16}
                            className="size-4"
                          />
                          <span className="sr-only">
                            Open shared wallet in Solscan
                          </span>
                        </a>
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>View on Solscan</TooltipContent>
                  </Tooltip>
                )}
              </div>
            </CardContent>
          </Card>
        ) : (
          <>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle>Main Wallet</CardTitle>
                <Badge variant="default">Main</Badge>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <div className="flex items-start gap-1">
                  <div className="break-all font-mono text-xs text-muted-foreground sm:text-sm">
                    {mainWallet?.publicKey || "Not available"}
                  </div>
                  {mainWallet && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="text-muted-foreground hover:text-foreground size-7"
                          onClick={() =>
                            void copyToClipboard(
                              mainWallet.publicKey,
                              "Main wallet public key"
                            )
                          }
                        >
                          <IconCopy className="size-3.5" />
                          <span className="sr-only">
                            Copy main wallet public key
                          </span>
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Copy public key</TooltipContent>
                    </Tooltip>
                  )}
                </div>
                <div className="flex flex-col gap-2">
                  <div className="text-2xl font-mono">
                    {Number(mainWallet?.balanceSol ?? 0).toFixed(4)} SOL
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Last refreshed{" "}
                    {formatRefreshTime(mainWallet?.balanceRefreshedAt)}
                  </div>
                </div>
                <div className="flex justify-end gap-2">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="outline"
                        size="icon"
                        onClick={() =>
                          mainWallet &&
                          handleRefreshBalances([mainWallet.publicKey])
                        }
                        disabled={isRefreshingBalances || !mainWallet}
                      >
                        {isRefreshingBalances ? (
                          <Spinner className="size-4" />
                        ) : (
                          <IconRefresh className="size-4" />
                        )}
                        <span className="sr-only">Refresh main wallet</span>
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Refresh</TooltipContent>
                  </Tooltip>
                  {mainWallet && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button variant="outline" size="icon" asChild>
                          <a
                            href={`https://solscan.io/account/${mainWallet.publicKey}`}
                            target="_blank"
                            rel="noreferrer"
                          >
                            <Image
                              src="/logos/solscan-logo-dark.svg"
                              alt=""
                              aria-hidden="true"
                              width={16}
                              height={16}
                              className="size-4"
                            />
                            <span className="sr-only">
                              Open main wallet in Solscan
                            </span>
                          </a>
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>View on Solscan</TooltipContent>
                    </Tooltip>
                  )}
                </div>
              </CardContent>
            </Card>

            {displayDevWallet && (
              <Card>
                <CardHeader className="flex flex-row items-center justify-between">
                  <CardTitle>Dev Wallet</CardTitle>
                  <Badge variant="secondary">Dev</Badge>
                </CardHeader>
                <CardContent className="flex flex-col gap-4">
                  <div className="flex items-start gap-1">
                    <div className="break-all font-mono text-xs text-muted-foreground sm:text-sm">
                      {displayDevWallet.publicKey}
                    </div>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="text-muted-foreground hover:text-foreground size-7"
                          onClick={() =>
                            void copyToClipboard(
                              displayDevWallet.publicKey,
                              "Dev wallet public key"
                            )
                          }
                        >
                          <IconCopy className="size-3.5" />
                          <span className="sr-only">
                            Copy dev wallet public key
                          </span>
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Copy public key</TooltipContent>
                    </Tooltip>
                  </div>
                  <div className="flex flex-col gap-2">
                    {isSystemDevWallet ? (
                      <Badge
                        variant="secondary"
                        className="w-fit border border-border/60 bg-secondary/60 text-muted-foreground"
                      >
                        System Wallet
                      </Badge>
                    ) : (
                      <>
                        <div className="text-2xl font-mono">
                          {Number(displayDevWallet.balanceSol ?? 0).toFixed(4)} SOL
                        </div>
                        <div className="text-xs text-muted-foreground">
                          Last refreshed{" "}
                          {formatRefreshTime(displayDevWallet.balanceRefreshedAt)}
                        </div>
                      </>
                    )}
                  </div>
                  {!isSystemDevWallet && (
                    <div className="flex justify-end gap-2">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="outline"
                            size="icon"
                            onClick={() =>
                              handleRefreshBalances([displayDevWallet.publicKey])
                            }
                            disabled={isRefreshingBalances}
                          >
                            {isRefreshingBalances ? (
                              <Spinner className="size-4" />
                            ) : (
                              <IconRefresh className="size-4" />
                            )}
                            <span className="sr-only">Refresh dev wallet</span>
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Refresh</TooltipContent>
                      </Tooltip>
                      {tokenPublicKey && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button variant="outline" size="icon" asChild>
                              <Link
                                href={`/${tokenPublicKey}/wallets/${displayDevWallet.publicKey}`}
                              >
                                <IconEye className="size-4" />
                                <span className="sr-only">View dev wallet</span>
                              </Link>
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>View wallet</TooltipContent>
                        </Tooltip>
                      )}
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button variant="outline" size="icon" asChild>
                            <a
                              href={`https://solscan.io/account/${displayDevWallet.publicKey}`}
                              target="_blank"
                              rel="noreferrer"
                            >
                              <Image
                                src="/logos/solscan-logo-dark.svg"
                                alt=""
                                aria-hidden="true"
                                width={16}
                                height={16}
                                className="size-4"
                              />
                              <span className="sr-only">
                                Open dev wallet in Solscan
                              </span>
                            </a>
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>View on Solscan</TooltipContent>
                      </Tooltip>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="outline"
                            size="icon"
                            onClick={() => handleOpenSend([displayDevWallet.publicKey])}
                          >
                            <IconArrowUpRight className="size-4" />
                            <span className="sr-only">Send SOL to dev wallet</span>
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Send SOL</TooltipContent>
                      </Tooltip>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="outline"
                            size="icon"
                            onClick={() =>
                              handleOpenReturn([displayDevWallet.publicKey])
                            }
                          >
                            <IconArrowDownRight className="size-4" />
                            <span className="sr-only">
                              Return SOL from dev wallet
                            </span>
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Return SOL</TooltipContent>
                      </Tooltip>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}
          </>
        )}
      </div>

      <div className="h-6" />
      <DataTable
        columns={columns}
        data={wallets}
        isLoading={
          operationalWalletsLoading || devWalletLoading || mainWalletLoading
        }
        enableRowSelection
        getRowId={(row) => row.publicKey}
        searchableColumns={["publicKey", "type"]}
        enableUrlState
        urlStatePrefix="wallets"
        onRowSelectionChange={setRowSelection}
        toolbar={(table) => (
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <DataTableSearch
              table={table}
              placeholder="Search wallets..."
              className="w-full sm:max-w-sm"
            />
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm text-muted-foreground">
                {selectedWalletPublicKeys.length} wallet
                {selectedWalletPublicKeys.length === 1 ? "" : "s"} selected
              </p>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleOpenSend(selectedWalletPublicKeys)}
                    disabled={selectedWalletPublicKeys.length === 0}
                  >
                    <IconArrowUpRight className="mr-2 size-4" />
                    Send SOL
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  Send SOL from the main wallet to selected wallets
                </TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleOpenReturn(selectedWalletPublicKeys)}
                    disabled={selectedWalletPublicKeys.length === 0}
                  >
                    <IconArrowDownRight className="mr-2 size-4" />
                    Return SOL
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  Send SOL from selected wallets to the main wallet
                </TooltipContent>
              </Tooltip>
              <DataTableViewOptions table={table} />
            </div>
          </div>
        )}
        pagination={(table) => <DataTablePagination table={table} />}
      />

      {tokenPublicKey && (
        <>
          <WalletTransferDialog
            open={sendDialogOpen}
            onOpenChange={setSendDialogOpen}
            mode="send"
            tokenPublicKey={tokenPublicKey}
            walletPublicKeys={sendTargets}
            wallets={transferWallets}
          />
          <WalletTransferDialog
            open={returnDialogOpen}
            onOpenChange={setReturnDialogOpen}
            mode="return"
            tokenPublicKey={tokenPublicKey}
            walletPublicKeys={returnTargets}
            wallets={transferWallets}
          />
        </>
      )}
    </div>
  );
}
