"use client";

import { useQueryState } from "nuqs";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { IconRefresh } from "@tabler/icons-react";
import { tokenQueryParser } from "@/lib/utils/token-query";
import { trpc } from "@/lib/trpc/client";
import { cacheConfig } from "@/lib/config/cache.config";
import { formatRefreshTime } from "@/lib/utils/relative-time";
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

export default function Page() {
  const [tokenPublicKey] = useQueryState("token", tokenQueryParser);
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

  const {
    data: operationalWalletsData,
    isLoading: operationalWalletsLoading,
    refetch: refetchOperationalWallets,
  } = trpc.wallet.getOperationalByToken.useQuery(
    { tokenPublicKey: tokenPublicKey || "" },
    { enabled: !!tokenPublicKey && !!tokenData }
  );

  const {
    data: devWallet,
    isLoading: devWalletLoading,
    refetch: refetchDevWallet,
  } = trpc.wallet.getDevByToken.useQuery(
    { tokenPublicKey: tokenPublicKey || "" },
    { enabled: !!tokenPublicKey && !!tokenData }
  );

  const {
    data: mainWallet,
    isLoading: mainWalletLoading,
    refetch: refetchMainWallet,
  } = trpc.wallet.getMain.useQuery({}, { enabled: !!tokenData });

  const {
    data: refreshCache,
    refetch: refetchRefreshCache,
    isLoading: refreshCacheLoading,
  } = trpc.refreshCache.getByScope.useQuery(
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

  const handleRefreshBalances = useCallback(
    async (
      walletPublicKeys?: string[],
      options?: { showToast?: boolean }
    ) => {
      if (!tokenPublicKey) return;
      const showToast = options?.showToast !== false;
      const toastId = showToast
        ? toast.loading("Refreshing wallet balances...", {
            icon: <Spinner className="size-4" />,
          })
        : null;

      try {
        const result = await refreshBalances({ tokenPublicKey, walletPublicKeys });
        await Promise.all([
          refetchOperationalWallets(),
          refetchDevWallet(),
          refetchMainWallet(),
          refetchRefreshCache(),
        ]);
        if (toastId) {
          if (result.length === 0) {
            toast.info(getCooldownMessage(walletPublicKeys), {
              id: toastId,
              icon: null,
            });
          } else {
            toast.success("Wallet balances refreshed", {
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
      refetchOperationalWallets,
      refetchDevWallet,
      refetchMainWallet,
      refetchRefreshCache,
      getCooldownMessage,
      refreshBalances,
      tokenPublicKey,
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
  const isStale =
    !refreshTimestamp ||
    Date.now() - new Date(refreshTimestamp).getTime() >=
      cacheConfig.staleMs.wallets;
  const autoRefreshTriggered = useRef(false);

  useEffect(() => {
    if (!tokenPublicKey || !tokenData) return;
    if (refreshCacheLoading) return;
    if (!isStale || isRefreshingBalances) return;
    if (autoRefreshTriggered.current) return;
    autoRefreshTriggered.current = true;
    void handleRefreshBalances(undefined, { showToast: false });
  }, [
    handleRefreshBalances,
    isRefreshingBalances,
    isStale,
    refreshCacheLoading,
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
      <div className="flex justify-between items-center gap-2 -m-6 px-6 py-10 border-b">
        <div>
          <h1 className="text-4xl">Wallets</h1>
          <div className="mt-3 flex items-center gap-3">
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
            <p className="text-sm text-muted-foreground">
              Last refresh: {formatRefreshTime(refreshTimestamp)}
            </p>
          </div>
        </div>
        <p className="leading-tight font-light text-right text-muted-foreground">
          Main and dev wallets appear above for quick access.
          <br />
          Operational wallets are listed below for actions and monitoring.
        </p>
      </div>

      <div className="grid gap-4 pt-6 md:grid-cols-2">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Main Wallet</CardTitle>
            <Badge variant="default">Main</Badge>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="text-sm text-muted-foreground">
              {mainWallet?.publicKey || "Not available"}
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
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  mainWallet && handleRefreshBalances([mainWallet.publicKey])
                }
                disabled={isRefreshingBalances || !mainWallet}
              >
                {isRefreshingBalances && <Spinner className="mr-2 size-4" />}
                Refresh
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Dev Wallet</CardTitle>
            <Badge variant="secondary">Dev</Badge>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="text-sm text-muted-foreground">
              {devWallet?.publicKey || "Not available"}
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
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  devWallet && handleRefreshBalances([devWallet.publicKey])
                }
                disabled={isRefreshingBalances || !devWallet}
              >
                {isRefreshingBalances && <Spinner className="mr-2 size-4" />}
                Refresh
              </Button>
              {devWallet && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleOpenReturn([devWallet.publicKey])}
                >
                  Return SOL
                </Button>
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
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleRefreshBalances()}
                disabled={isRefreshingBalances || !tokenPublicKey}
              >
                {isRefreshingBalances && <Spinner className="mr-2 size-4" />}
                Refresh all
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleOpenSend(selectedWalletPublicKeys)}
                disabled={selectedWalletPublicKeys.length === 0}
              >
                Send SOL
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleOpenReturn(selectedWalletPublicKeys)}
                disabled={selectedWalletPublicKeys.length === 0}
              >
                Return SOL
              </Button>
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
            onSuccess={() => handleRefreshBalances(sendTargets)}
          />
          <WalletTransferDialog
            open={returnDialogOpen}
            onOpenChange={setReturnDialogOpen}
            mode="return"
            tokenPublicKey={tokenPublicKey}
            walletPublicKeys={returnTargets}
            wallets={transferWallets}
            onSuccess={() => handleRefreshBalances(returnTargets)}
          />
        </>
      )}
    </div>
  );
}
