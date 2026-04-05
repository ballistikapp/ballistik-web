"use client";

import Image from "next/image";
import { useParams } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import {
  IconArrowDownRight,
  IconArrowUpRight,
  IconCopy,
  IconEye,
  IconRefresh,
} from "@tabler/icons-react";
import { trpc } from "@/lib/trpc/client";
import { cacheConfig } from "@/lib/config/cache.config";
import { formatRefreshTime } from "@/lib/utils/relative-time";
import { copyToClipboard } from "@/lib/utils";
import { TokenNotFound } from "@/components/placeholders/token-not-found";
import { DashboardLoading } from "../../dashboard/dashboard-loading";
import {
  DataTable,
  DataTablePagination,
  DataTableSearch,
  DataTableViewOptions,
} from "@/components/data-table";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { WalletTransferDialog } from "@/components/wallets/wallet-transfer-dialog";
import { Spinner } from "@/components/ui/spinner";
import { PageHeader } from "@/components/layout/sections";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { getHoldingsColumns } from "./holdings-columns";
import { getTransactionsColumns } from "./transactions-columns";
import Link from "next/link";

type RefreshedWallet = {
  publicKey: string;
  balanceSol: number;
  balanceRefreshedAt: Date | string;
};

const SHARED_MAIN_DEV_LABEL = "Main Wallet (used as dev)";

export default function WalletPage() {
  const params = useParams<{
    tokenPublicKey: string;
    walletPublicKey: string;
  }>();
  const tokenPublicKey = params?.tokenPublicKey;
  const walletPublicKey = params?.walletPublicKey;
  const utils = trpc.useUtils();
  const [sendDialogOpen, setSendDialogOpen] = useState(false);
  const [returnDialogOpen, setReturnDialogOpen] = useState(false);
  const [privateKeyDialogOpen, setPrivateKeyDialogOpen] = useState(false);
  const [privateKey, setPrivateKey] = useState<string | null>(null);

  const {
    data,
    isLoading,
    error,
    refetch: refetchWallet,
  } = trpc.wallet.getByPublicKey.useQuery(
    {
      tokenPublicKey: tokenPublicKey || "",
      walletPublicKey: walletPublicKey || "",
    },
    { enabled: !!tokenPublicKey && !!walletPublicKey }
  );
  const { data: devWallet } = trpc.wallet.getDevByToken.useQuery(
    { tokenPublicKey: tokenPublicKey || "" },
    { enabled: !!tokenPublicKey }
  );

  const { mutateAsync: refreshBalances, isPending: isRefreshingBalances } =
    trpc.wallet.refreshBalances.useMutation();
  const { mutateAsync: refreshHoldings, isPending: isRefreshingHoldings } =
    trpc.holding.refreshByToken.useMutation();
  const {
    mutateAsync: refreshTransactions,
    isPending: isRefreshingTransactions,
  } = trpc.transaction.refreshByToken.useMutation();
  const getPrivateKeyMutation = trpc.wallet.getPrivateKey.useMutation();
  const { data: holdingsData, isLoading: holdingsLoading } =
    trpc.holding.listByToken.useQuery(
      {
        tokenPublicKey: tokenPublicKey || "",
        walletPublicKey: walletPublicKey || "",
        page: 1,
        pageSize: 100,
      },
      { enabled: !!tokenPublicKey && !!walletPublicKey }
    );
  const { data: transactionsData, isLoading: transactionsLoading } =
    trpc.transaction.listByToken.useQuery(
      {
        tokenPublicKey: tokenPublicKey || "",
        walletPublicKey: walletPublicKey || "",
        groupBySignature: false,
        page: 1,
        pageSize: 100,
      },
      { enabled: !!tokenPublicKey && !!walletPublicKey }
    );

  const getCooldownMessage = () => {
    const lastRefreshedAt = data?.wallet.balanceRefreshedAt;
    if (!lastRefreshedAt) {
      return "Wallet balance was refreshed recently.";
    }
    const last = new Date(lastRefreshedAt).getTime();
    const remainingMs =
      cacheConfig.cooldownMs.walletBalances - (Date.now() - last);
    if (Number.isNaN(remainingMs) || remainingMs <= 0) {
      return "Wallet balance was refreshed recently.";
    }
    const waitSeconds = Math.max(1, Math.ceil(remainingMs / 1000));
    return `Wallet balance was refreshed recently. Try again in ${waitSeconds}s.`;
  };

  const handlePrivateKeyDialogChange = (open: boolean) => {
    setPrivateKeyDialogOpen(open);
    if (!open) {
      setPrivateKey(null);
      getPrivateKeyMutation.reset();
    }
  };

  const handleGetPrivateKey = async () => {
    if (!tokenPublicKey || !walletPublicKey) return;
    try {
      const result = await getPrivateKeyMutation.mutateAsync({
        tokenPublicKey,
        walletPublicKey,
      });
      setPrivateKey(result.privateKey);
    } catch (fetchError) {
      const message =
        fetchError instanceof Error
          ? fetchError.message
          : "Failed to fetch private key";
      toast.error(message);
    }
  };

  const handleRefresh = async () => {
    if (!tokenPublicKey || !walletPublicKey) return;
    const toastId = toast.loading("Refreshing wallet balance...", {
      icon: <Spinner className="size-4" />,
    });

    try {
      const result = await refreshBalances({
        tokenPublicKey,
        walletPublicKeys: [walletPublicKey],
      });
      const refreshedWallet = result.refreshed[0];
      if (refreshedWallet) {
        const refreshed: RefreshedWallet = refreshedWallet;
        utils.wallet.getOperationalByToken.setData(
          { tokenPublicKey },
          (current) => {
            if (!current) return current;
            return {
              ...current,
              wallets: current.wallets.map((entry) =>
                entry.publicKey === refreshed.publicKey
                  ? {
                      ...entry,
                      balanceSol: refreshed.balanceSol as never,
                      balanceRefreshedAt: new Date(
                        refreshed.balanceRefreshedAt
                      ),
                    }
                  : entry
              ),
            };
          }
        );
        utils.wallet.getDevByToken.setData({ tokenPublicKey }, (current) => {
          if (!current || current.publicKey !== refreshed.publicKey)
            return current;
          return {
            ...current,
            balanceSol: refreshed.balanceSol as never,
            balanceRefreshedAt: new Date(refreshed.balanceRefreshedAt),
          };
        });
        utils.wallet.getMain.setData({}, (current) => {
          if (!current || current.publicKey !== refreshed.publicKey)
            return current;
          return {
            ...current,
            balanceSol: refreshed.balanceSol as never,
            balanceRefreshedAt: new Date(refreshed.balanceRefreshedAt),
          };
        });
        await refetchWallet();
        toast.success("Wallet balance refreshed", { id: toastId, icon: null });
      } else if (result.skippedCooldown.length > 0) {
        toast.info(getCooldownMessage(), { id: toastId, icon: null });
      } else if (result.skippedNotAllowed.length > 0) {
        toast.info("Wallet is not available for this token", {
          id: toastId,
          icon: null,
        });
      } else {
        toast.info("No wallets were refreshed", { id: toastId, icon: null });
      }
    } catch {
      toast.error("Failed to refresh wallet balance", {
        id: toastId,
        icon: null,
      });
    }
  };

  const handleRefreshHoldings = async () => {
    if (!tokenPublicKey || !walletPublicKey) return;
    const toastId = toast.loading("Refreshing holdings...", {
      icon: <Spinner className="size-4" />,
    });
    try {
      await refreshHoldings({
        tokenPublicKey,
        walletPublicKeys: [walletPublicKey],
      });
      await utils.holding.listByToken.invalidate();
      toast.success("Holdings refreshed", { id: toastId, icon: null });
    } catch {
      toast.error("Failed to refresh holdings", { id: toastId, icon: null });
    }
  };

  const handleRefreshTransactions = async () => {
    if (!tokenPublicKey || !walletPublicKey) return;
    const toastId = toast.loading("Refreshing transactions...", {
      icon: <Spinner className="size-4" />,
    });
    try {
      await refreshTransactions({
        tokenPublicKey,
        walletPublicKeys: [walletPublicKey],
      });
      await utils.transaction.listByToken.invalidate();
      toast.success("Transactions refreshed", { id: toastId, icon: null });
    } catch {
      toast.error("Failed to refresh transactions", {
        id: toastId,
        icon: null,
      });
    }
  };

  if (isLoading) {
    return <DashboardLoading />;
  }

  if (!data) {
    return (
      <TokenNotFound
        error={error as Error | null}
        onRetry={() => refetchWallet()}
      />
    );
  }

  const { wallet, token } = data;
  const isMainWallet = wallet.type === "MAIN_WALLET";
  const isSharedMainDevWallet =
    isMainWallet && devWallet?.publicKey === wallet.publicKey;
  const walletTitle = {
    MAIN_WALLET: "Main Wallet",
    DEV: "Dev Wallet",
    BUNDLER: "Bundler Wallet",
    VOLUME: "Volume Bot Wallet",
    DISTRIBUTION: "Distribution Wallet",
  }[wallet.type];
  const resolvedWalletTitle = isSharedMainDevWallet
    ? SHARED_MAIN_DEV_LABEL
    : walletTitle;
  const holdingsColumns = getHoldingsColumns({
    tokenSymbol: token.symbol,
    tokenSupply: holdingsData?.totalSupply ?? null,
  });
  const transactionsColumns = getTransactionsColumns({
    tokenSymbol: token.symbol,
  });
  const holdings = holdingsData?.holdings ?? [];
  const transactions = transactionsData?.items ?? [];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={resolvedWalletTitle ?? "Wallet"}
        rightContent={
          <div className="flex w-full flex-col items-start gap-3 md:items-end md:gap-4">
            <div className="text-left md:text-right">
              <p className="text-xs uppercase tracking-tighter font-mono font-semibold text-muted-foreground">
                WALLET BALANCE
              </p>
              <p className="font-mono leading-none">
                <span className="text-2xl md:text-4xl">
                  {Number(wallet.balanceSol ?? 0).toFixed(4)}
                </span>{" "}
                <span className="text-base text-muted-foreground">SOL</span>
              </p>
            </div>
            <div className="flex w-full flex-wrap items-center gap-2 md:w-auto md:justify-end md:gap-3">
              <p className="text-sm text-muted-foreground">
                Last refresh: {formatRefreshTime(wallet.balanceRefreshedAt)}
              </p>
              <Button
                variant="outline"
                size="sm"
                onClick={handleRefresh}
                disabled={isRefreshingBalances}
              >
                {isRefreshingBalances ? (
                  <Spinner className="mr-2 size-4" />
                ) : (
                  <IconRefresh className="mr-2 size-4" />
                )}
                Refresh Balance
              </Button>
            </div>
          </div>
        }
      />
      <div className="flex flex-col gap-6 pt-6 md:pt-8 lg:flex-row lg:items-start lg:justify-between">
        <div className="space-y-6">
          <div className="space-y-2">
            <p className="text-xs uppercase tracking-tighter font-mono font-semibold text-muted-foreground">
              WALLET PUBLIC KEY
            </p>
            <Tooltip>
              <TooltipTrigger
                asChild
                onClick={() => copyToClipboard(wallet.publicKey, "Public key")}
              >
                <code className="cursor-pointer break-all font-mono text-lg tracking-tighter text-muted-foreground hover:text-foreground sm:text-xl md:text-2xl">
                  {wallet.publicKey}
                </code>
              </TooltipTrigger>
              <TooltipContent>Copy Public Key</TooltipContent>
            </Tooltip>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => copyToClipboard(wallet.publicKey, "Public key")}
            >
              <IconCopy className="size-4" />
              Copy Public Key
            </Button>
            <Button
              size="sm"
              variant="destructive"
              onClick={() => setPrivateKeyDialogOpen(true)}
            >
              <IconEye className="mr-2 size-4" />
              Show Private Key
            </Button>
            <Button size="sm" variant="ghost" asChild>
              <Link
                href={`https://solscan.io/account/${wallet.publicKey}`}
                target="_blank"
                rel="noreferrer"
              >
                <Image
                  src="/logos/solscan-logo-dark.svg"
                  alt=""
                  aria-hidden="true"
                  width={16}
                  height={16}
                  className="mr-2 size-4"
                />
                View on Solscan
              </Link>
            </Button>
          </div>
        </div>

        <div className="space-y-2 lg:text-right">
          <p className="text-sm text-muted-foreground">Actions</p>
          <div className="flex flex-wrap gap-2 lg:justify-end">
            {!isMainWallet && (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setSendDialogOpen(true)}
                >
                  <IconArrowUpRight className="mr-2 size-4" />
                  Send SOL
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setReturnDialogOpen(true)}
                >
                  <IconArrowDownRight className="mr-2 size-4" />
                  Return SOL
                </Button>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="my-8 border-t" />

      <section className="space-y-5 py-2">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-2xl md:text-3xl">Holdings</h2>
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm text-muted-foreground">
              {(holdingsData?.totalCount ?? holdings.length)} position
              {(holdingsData?.totalCount ?? holdings.length) === 1 ? "" : "s"}
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={handleRefreshHoldings}
              disabled={isRefreshingHoldings}
            >
              {isRefreshingHoldings ? (
                <Spinner className="mr-2 size-4" />
              ) : (
                <IconRefresh className="mr-2 size-4" />
              )}
              Refresh
            </Button>
          </div>
        </div>
        <DataTable
          columns={holdingsColumns}
          data={holdings}
          isLoading={holdingsLoading}
          enableUrlState
          urlStatePrefix="wallet-holdings"
          pagination={(table) => <DataTablePagination table={table} />}
          toolbar={(table) => (
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <DataTableSearch
                table={table}
                placeholder="Search holdings..."
                className="w-full sm:max-w-sm"
              />
              <DataTableViewOptions table={table} />
            </div>
          )}
        />
      </section>

      <div className="my-8 border-t" />

      <section className="space-y-5 py-2">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-2xl md:text-3xl">Transactions</h2>
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm text-muted-foreground">
              {(transactionsData?.totalCount ?? transactions.length)} tx
              {(transactionsData?.totalCount ?? transactions.length) === 1
                ? ""
                : "s"}
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={handleRefreshTransactions}
              disabled={isRefreshingTransactions}
            >
              {isRefreshingTransactions ? (
                <Spinner className="mr-2 size-4" />
              ) : (
                <IconRefresh className="mr-2 size-4" />
              )}
              Refresh
            </Button>
          </div>
        </div>
        <DataTable
          columns={transactionsColumns}
          data={transactions}
          isLoading={transactionsLoading}
          enableUrlState
          urlStatePrefix="wallet-transactions"
          searchableColumns={[
            "transactionType",
            "status",
            "transactionSignature",
          ]}
          pagination={(table) => <DataTablePagination table={table} />}
          toolbar={(table) => (
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <DataTableSearch
                table={table}
                placeholder="Search transactions..."
                className="w-full sm:max-w-sm"
              />
              <DataTableViewOptions table={table} />
            </div>
          )}
        />
      </section>

      <Dialog
        open={privateKeyDialogOpen}
        onOpenChange={handlePrivateKeyDialogChange}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Private key</DialogTitle>
            <DialogDescription>
              Fetch and copy the private key for this wallet.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            {privateKey ? (
              <Textarea
                readOnly
                rows={4}
                value={privateKey}
                className="font-mono text-xs"
              />
            ) : (
              <div className="text-sm text-muted-foreground">
                Click get private key to fetch it from the server.
              </div>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => handlePrivateKeyDialogChange(false)}
              disabled={getPrivateKeyMutation.isPending}
            >
              Close
            </Button>
            {privateKey ? (
              <Button
                onClick={() => copyToClipboard(privateKey, "Private key")}
              >
                Copy private key
              </Button>
            ) : (
              <Button
                onClick={handleGetPrivateKey}
                disabled={getPrivateKeyMutation.isPending || !tokenPublicKey}
              >
                {getPrivateKeyMutation.isPending && (
                  <Spinner className="mr-2 size-4" />
                )}
                Get private key
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {!isMainWallet && tokenPublicKey && (
        <>
          <WalletTransferDialog
            open={sendDialogOpen}
            onOpenChange={setSendDialogOpen}
            mode="send"
            tokenPublicKey={tokenPublicKey}
            walletPublicKeys={[wallet.publicKey]}
          />
          <WalletTransferDialog
            open={returnDialogOpen}
            onOpenChange={setReturnDialogOpen}
            mode="return"
            tokenPublicKey={tokenPublicKey}
            walletPublicKeys={[wallet.publicKey]}
          />
        </>
      )}
    </div>
  );
}
