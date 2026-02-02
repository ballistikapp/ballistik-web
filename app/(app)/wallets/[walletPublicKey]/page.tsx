"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useQueryState } from "nuqs";
import { useState } from "react";
import { toast } from "sonner";
import { tokenQueryParser } from "@/lib/utils/token-query";
import { trpc } from "@/lib/trpc/client";
import { cacheConfig } from "@/lib/config/cache.config";
import { formatRefreshTime } from "@/lib/utils/relative-time";
import { copyToClipboard } from "@/lib/utils";
import { TokenNotFound } from "@/components/placeholders/token-not-found";
import { DashboardLoading } from "../../dashboard/dashboard-loading";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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

export default function WalletPage() {
  const params = useParams();
  const walletPublicKey = params?.walletPublicKey as string;
  const [tokenPublicKey] = useQueryState("token", tokenQueryParser);
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

  const { mutateAsync: refreshBalances, isPending: isRefreshingBalances } =
    trpc.wallet.refreshBalances.useMutation();
  const getPrivateKeyMutation = trpc.wallet.getPrivateKey.useMutation();

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
      if (result.length > 0) {
        await refetchWallet();
        toast.success("Wallet balance refreshed", { id: toastId, icon: null });
      } else {
        toast.info(getCooldownMessage(), { id: toastId, icon: null });
      }
    } catch (error) {
      toast.error("Failed to refresh wallet balance", {
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

  const { wallet, token, mainWallet } = data;
  const isMainWallet = wallet.type === "MAIN_WALLET";

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-2 -m-6 px-6 py-10 border-b">
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <Link
              href={`/wallets?token=${token.publicKey}`}
              className="text-sm text-muted-foreground hover:underline"
            >
              Back to wallets
            </Link>
            <Badge variant="outline">{wallet.type}</Badge>
          </div>
          <h1 className="text-3xl">
            {isMainWallet ? "User Wallet" : "Wallet"}
          </h1>
        </div>
        <Button
          variant="outline"
          onClick={handleRefresh}
          disabled={isRefreshingBalances}
        >
          {isRefreshingBalances && <Spinner className="mr-2 size-4" />}
          Refresh balance
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{isMainWallet ? "Profile" : "Wallet Details"}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <div className="text-sm text-muted-foreground">Public Key</div>
              <div className="flex items-center gap-2">
                <code className="text-sm">{wallet.publicKey}</code>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    copyToClipboard(wallet.publicKey, "Public key")
                  }
                >
                  Copy
                </Button>
                <Button size="sm" variant="outline" asChild>
                  <a
                    href={`https://solscan.io/account/${wallet.publicKey}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    View on Solscan
                  </a>
                </Button>
              </div>
            </div>
            <div className="flex flex-col gap-2">
              <div className="text-sm text-muted-foreground">Private Key</div>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setPrivateKeyDialogOpen(true)}
              >
                Show private key
              </Button>
            </div>
            <div className="flex flex-col gap-2">
              <div className="text-sm text-muted-foreground">Token</div>
              <div className="flex items-center gap-2">
                <span className="text-sm">
                  {token.name} ({token.symbol})
                </span>
                <Link
                  href={`/launch?token=${token.publicKey}`}
                  className="text-sm text-muted-foreground hover:underline"
                >
                  View token
                </Link>
              </div>
            </div>
            {isMainWallet && mainWallet && (
              <div className="flex flex-col gap-2">
                <div className="text-sm text-muted-foreground">Auth Wallet</div>
                <div className="text-sm">{mainWallet.publicKey}</div>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Balances</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <div className="text-2xl font-mono">
              {Number(wallet.balanceSol).toFixed(4)} SOL
            </div>
            <div className="text-xs text-muted-foreground">
              Last refreshed {formatRefreshTime(wallet.balanceRefreshedAt)}
            </div>
            {!isMainWallet && (
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setSendDialogOpen(true)}
                >
                  Send SOL
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setReturnDialogOpen(true)}
                >
                  Return SOL
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

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
            onSuccess={handleRefresh}
          />
          <WalletTransferDialog
            open={returnDialogOpen}
            onOpenChange={setReturnDialogOpen}
            mode="return"
            tokenPublicKey={tokenPublicKey}
            walletPublicKeys={[wallet.publicKey]}
            onSuccess={handleRefresh}
          />
        </>
      )}
    </div>
  );
}
