"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useQueryState } from "nuqs";
import { formatDistanceToNowStrict } from "date-fns";
import { tokenQueryParser } from "@/lib/utils/token-query";
import { trpc } from "@/lib/trpc/client";
import { copyToClipboard } from "@/lib/utils";
import { TokenNotFound } from "@/components/placeholders/token-not-found";
import { DashboardLoading } from "../../dashboard/dashboard-loading";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { WalletTransferDialog } from "@/components/wallets/wallet-transfer-dialog";
import { useState } from "react";

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

export default function WalletPage() {
  const params = useParams();
  const walletPublicKey = params?.walletPublicKey as string;
  const [tokenPublicKey] = useQueryState("token", tokenQueryParser);
  const [sendDialogOpen, setSendDialogOpen] = useState(false);
  const [returnDialogOpen, setReturnDialogOpen] = useState(false);

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

  const handleRefresh = async () => {
    if (!tokenPublicKey || !walletPublicKey) return;
    await refreshBalances({
      tokenPublicKey,
      walletPublicKeys: [walletPublicKey],
    });
    await refetchWallet();
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
          disabled={isRefreshingBalances || !canRefresh(wallet.balanceRefreshedAt)}
        >
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
                  onClick={() => copyToClipboard(wallet.publicKey, "Public key")}
                >
                  Copy
                </Button>
              </div>
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
            <div className="text-sm text-muted-foreground">
              {Number(wallet.tokenBalance).toFixed(4)} {token.symbol}
            </div>
            <div className="text-xs text-muted-foreground">
              Last refreshed {formatRelativeTime(wallet.balanceRefreshedAt)}
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
