"use client";

import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  IconArrowDownRight,
  IconArrowUpRight,
  IconCopy,
  IconExternalLink,
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

  const wallets = operationalWalletsData?.wallets ?? [];
  const allWallets = useMemo(
    () => [
      ...(mainWallet ? [mainWallet] : []),
      ...(devWallet ? [devWallet] : []),
      ...wallets,
    ],
    [devWallet, mainWallet, wallets]
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
      } catch (error) {
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
      <div className="flex justify-between items-center gap-2 -m-6 px-6 py-6 border-b">
        <h1 className="text-4xl">Wallets</h1>

        <div className="mt-3 flex flex-col items-end gap-4">
          <div className="text-right">
            <p className="text-xs uppercase tracking-tighter font-mono font-semibold text-muted-foreground">
              TOTAL BALANCE
            </p>
            <p className="font-mono leading-none">
              <span className="text-4xl">{totalSolBalance.toFixed(4)}</span>{" "}
              <span className="text-base text-muted-foreground">SOL</span>
            </p>
          </div>
          <div className="flex items-center gap-3">
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
      </div>

      <div className="grid gap-4 pt-6 md:grid-cols-2">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Main Wallet</CardTitle>
            <Badge variant="default">Main</Badge>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="flex items-center gap-1">
              <div className="text-sm text-muted-foreground">
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
                        <IconExternalLink className="size-4" />
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

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Dev Wallet</CardTitle>
            <Badge variant="secondary">Dev</Badge>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="flex items-center gap-1">
              <div className="text-sm text-muted-foreground">
                {devWallet?.publicKey || "Not available"}
              </div>
              {devWallet && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-muted-foreground hover:text-foreground size-7"
                      onClick={() =>
                        void copyToClipboard(
                          devWallet.publicKey,
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
              )}
            </div>
            <div className="flex flex-col gap-2">
              <div className="text-2xl font-mono">
                {Number(devWallet?.balanceSol ?? 0).toFixed(4)} SOL
              </div>
              <div className="text-xs text-muted-foreground">
                Last refreshed{" "}
                {formatRefreshTime(devWallet?.balanceRefreshedAt)}
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() =>
                      devWallet && handleRefreshBalances([devWallet.publicKey])
                    }
                    disabled={isRefreshingBalances || !devWallet}
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
              {devWallet && tokenPublicKey && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant="outline" size="icon" asChild>
                      <Link
                        href={`/${tokenPublicKey}/wallets/${devWallet.publicKey}`}
                      >
                        <IconEye className="size-4" />
                        <span className="sr-only">View dev wallet</span>
                      </Link>
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>View wallet</TooltipContent>
                </Tooltip>
              )}
              {devWallet && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant="outline" size="icon" asChild>
                      <a
                        href={`https://solscan.io/account/${devWallet.publicKey}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        <IconExternalLink className="size-4" />
                        <span className="sr-only">
                          Open dev wallet in Solscan
                        </span>
                      </a>
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>View on Solscan</TooltipContent>
                </Tooltip>
              )}
              {devWallet && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={() => handleOpenSend([devWallet.publicKey])}
                    >
                      <IconArrowUpRight className="size-4" />
                      <span className="sr-only">Send SOL to dev wallet</span>
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Send SOL</TooltipContent>
                </Tooltip>
              )}
              {devWallet && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={() => handleOpenReturn([devWallet.publicKey])}
                    >
                      <IconArrowDownRight className="size-4" />
                      <span className="sr-only">
                        Return SOL from dev wallet
                      </span>
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Return SOL</TooltipContent>
                </Tooltip>
              )}
            </div>
          </CardContent>
        </Card>
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
          <div className="flex items-center justify-between gap-2">
            <DataTableSearch
              table={table}
              placeholder="Search wallets..."
              className="max-w-sm"
            />
            <div className="flex items-center gap-2">
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
