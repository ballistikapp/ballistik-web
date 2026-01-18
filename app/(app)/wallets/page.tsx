"use client";

import { formatDistanceToNowStrict } from "date-fns";
import { useQueryState } from "nuqs";
import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import { tokenQueryParser } from "@/lib/utils/token-query";
import { trpc } from "@/lib/trpc/client";
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

function formatRelativeTime(dateValue?: Date | string | null) {
  if (!dateValue) return "Never";
  const date = typeof dateValue === "string" ? new Date(dateValue) : dateValue;
  if (Number.isNaN(date.getTime())) return "Never";
  return `${formatDistanceToNowStrict(date)} ago`;
}

function canRefresh(dateValue?: Date | string | null) {
  if (!dateValue) return true;
  const date = typeof dateValue === "string" ? new Date(dateValue) : dateValue;
  if (Number.isNaN(date.getTime())) return true;
  return Date.now() - date.getTime() >= 15_000;
}

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

  const { mutateAsync: refreshBalances, isPending: isRefreshingBalances } =
    trpc.wallet.refreshBalances.useMutation();

  const handleRefreshBalances = useCallback(
    async (walletPublicKeys?: string[]) => {
      if (!tokenPublicKey) return;
      const toastId = toast.loading("Refreshing wallet balances...", {
        icon: <Spinner className="size-4" />,
      });

      try {
        await refreshBalances({ tokenPublicKey, walletPublicKeys });
        await Promise.all([
          refetchOperationalWallets(),
          refetchDevWallet(),
          refetchMainWallet(),
        ]);
        toast.success("Wallet balances refreshed", { id: toastId, icon: null });
      } catch (error) {
        toast.error("Failed to refresh wallet balances", {
          id: toastId,
          icon: null,
        });
      }
    },
    [
      refetchOperationalWallets,
      refetchDevWallet,
      refetchMainWallet,
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

  const columns = useMemo(() => {
    if (!tokenPublicKey) return [];
    return getColumns({
      tokenPublicKey,
      onRefresh: (walletPublicKey) => handleRefreshBalances([walletPublicKey]),
      onSend: (walletPublicKey) => handleOpenSend([walletPublicKey]),
      onReturn: (walletPublicKey) => handleOpenReturn([walletPublicKey]),
    });
  }, [handleOpenReturn, handleOpenSend, handleRefreshBalances, tokenPublicKey]);

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

  const wallets = operationalWalletsData?.wallets ?? [];
  const allWallets = [
    ...(mainWallet ? [mainWallet] : []),
    ...(devWallet ? [devWallet] : []),
    ...wallets,
  ];
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
  const canRefreshAny = allWallets.some((wallet) =>
    canRefresh(wallet.balanceRefreshedAt)
  );

  return (
    <div className="flex flex-col gap-6">
      <div className="flex justify-between items-center gap-2 -m-6 px-6 py-10 border-b">
        <h1 className="text-4xl">Wallets</h1>
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
                {formatRelativeTime(mainWallet?.balanceRefreshedAt)}
              </div>
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  mainWallet && handleRefreshBalances([mainWallet.publicKey])
                }
                disabled={
                  isRefreshingBalances ||
                  !mainWallet ||
                  !canRefresh(mainWallet.balanceRefreshedAt)
                }
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
                {formatRelativeTime(devWallet?.balanceRefreshedAt)}
              </div>
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  devWallet && handleRefreshBalances([devWallet.publicKey])
                }
                disabled={
                  isRefreshingBalances ||
                  !devWallet ||
                  !canRefresh(devWallet.balanceRefreshedAt)
                }
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
                disabled={isRefreshingBalances || !canRefreshAny}
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
