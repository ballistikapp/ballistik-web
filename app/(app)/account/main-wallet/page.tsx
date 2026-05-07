"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { toast } from "sonner";
import {
  IconArrowUpRight,
  IconArrowDownLeft,
  IconCopy,
  IconKey,
} from "@tabler/icons-react";
import { trpc } from "@/lib/trpc/client";
import { cacheConfig } from "@/lib/config/cache.config";
import { copyToClipboard } from "@/lib/utils";
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
import { Spinner } from "@/components/ui/spinner";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { AccountSendDialog } from "@/components/wallets/account-send-dialog";
import { MainWalletDepositDialog } from "@/components/wallets/main-wallet-deposit-dialog";
import { MainWalletWithdrawDialog } from "@/components/wallets/main-wallet-withdraw-dialog";

export default function AccountMainWalletPage() {
  const { data: currentUser, isLoading: userLoading } = trpc.auth.me.useQuery();
  const mainWalletQuery = trpc.wallet.getMain.useQuery(
    {},
    {
      enabled: !!currentUser,
      staleTime: cacheConfig.staleMs.wallets,
    }
  );
  const getPrivateKeyMutation = trpc.wallet.getMainPrivateKey.useMutation();

  const [privateKeyDialogOpen, setPrivateKeyDialogOpen] = useState(false);
  const [privateKey, setPrivateKey] = useState<string | null>(null);
  const [sendDialogOpen, setSendDialogOpen] = useState(false);
  const [depositDialogOpen, setDepositDialogOpen] = useState(false);
  const [withdrawDialogOpen, setWithdrawDialogOpen] = useState(false);

  const wallet = mainWalletQuery.data;
  const balanceSol = Number(wallet?.balanceSol ?? 0);

  const handlePrivateKeyDialogChange = (open: boolean) => {
    setPrivateKeyDialogOpen(open);
    if (!open) {
      setPrivateKey(null);
      getPrivateKeyMutation.reset();
    }
  };

  const handleGetPrivateKey = async () => {
    try {
      const result = await getPrivateKeyMutation.mutateAsync({});
      setPrivateKey(result.privateKey);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to fetch private key";
      toast.error(message);
    }
  };

  if (userLoading) {
    return (
      <div className="flex flex-col gap-6">
        <Skeleton className="h-24 w-full rounded-xl" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    );
  }

  if (!currentUser) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-20">
        <p className="text-muted-foreground">You are not logged in.</p>
        <Button asChild>
          <Link href="/auth">Log in</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Wallet info */}
      <div className="flex flex-col gap-6 pt-6 md:pt-8">
        <div className="space-y-6">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="lg"
              onClick={() => setDepositDialogOpen(true)}
            >
              <IconArrowDownLeft className="size-4" />
              Deposit
            </Button>
            <Button
              variant="outline"
              size="lg"
              onClick={() => setWithdrawDialogOpen(true)}
            >
              <IconArrowUpRight className="size-4" />
              Withdraw
            </Button>
            <Button
              variant="outline"
              size="lg"
              onClick={() => setSendDialogOpen(true)}
            >
              <IconArrowUpRight className="size-4" />
              Send SOL To Your Wallets
            </Button>
          </div>

          <div className="h-4" />

          <div className="space-y-2">
            <p className="text-xs uppercase tracking-tighter font-mono font-semibold text-muted-foreground">
              MAIN WALLET PUBLIC KEY
            </p>
            <div className="flex items-center gap-1.5">
              <code className="font-mono text-base tracking-tighter break-all sm:text-lg md:text-2xl">
                {currentUser.mainWalletPublicKey}
              </code>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 shrink-0 text-muted-foreground hover:text-foreground"
                    onClick={() =>
                      copyToClipboard(
                        currentUser.mainWalletPublicKey,
                        "Public key"
                      )
                    }
                  >
                    <IconCopy className="size-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Copy Public Key</TooltipContent>
              </Tooltip>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="destructive"
              onClick={() => setPrivateKeyDialogOpen(true)}
            >
              <IconKey className="size-4" />
              Show Private Key
            </Button>
            <Button size="sm" variant="ghost" asChild>
              <Link
                href={`https://solscan.io/account/${currentUser.mainWalletPublicKey}`}
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
                View on Solscan
              </Link>
            </Button>
          </div>
        </div>
      </div>

      {/* Private Key Dialog */}
      <Dialog
        open={privateKeyDialogOpen}
        onOpenChange={handlePrivateKeyDialogChange}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Private key</DialogTitle>
            <DialogDescription>
              Fetch and copy the private key for your main wallet.
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
                disabled={getPrivateKeyMutation.isPending}
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

      {/* Send SOL Dialog */}
      <AccountSendDialog
        open={sendDialogOpen}
        onOpenChange={setSendDialogOpen}
      />
      <MainWalletDepositDialog
        open={depositDialogOpen}
        onOpenChange={setDepositDialogOpen}
        publicKey={currentUser.mainWalletPublicKey}
      />
      <MainWalletWithdrawDialog
        open={withdrawDialogOpen}
        onOpenChange={setWithdrawDialogOpen}
        balanceSol={balanceSol}
      />
    </div>
  );
}
