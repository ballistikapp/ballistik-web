"use client";

import { useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  IconArrowUpRight,
  IconArrowDownLeft,
  IconCheck,
  IconCopy,
  IconExternalLink,
  IconKey,
  IconPencil,
  IconRefresh,
  IconX,
} from "@tabler/icons-react";
import { trpc } from "@/lib/trpc/client";
import { cacheConfig } from "@/lib/config/cache.config";
import { formatRefreshTime } from "@/lib/utils/relative-time";
import { copyToClipboard } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { PageHeader } from "@/components/layout/sections";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { AccountSendDialog } from "@/components/wallets/account-send-dialog";
import { MainWalletDepositDialog } from "@/components/wallets/main-wallet-deposit-dialog";
import { MainWalletWithdrawDialog } from "@/components/wallets/main-wallet-withdraw-dialog";

export default function AccountPage() {
  const utils = trpc.useUtils();
  const { data: currentUser, isLoading: userLoading } = trpc.auth.me.useQuery();
  const mainWalletQuery = trpc.wallet.getMain.useQuery(
    {},
    {
      enabled: !!currentUser,
      staleTime: cacheConfig.staleMs.wallets,
    }
  );
  const refreshMainBalance = trpc.wallet.refreshMainBalance.useMutation({
    onSuccess: () => {
      mainWalletQuery.refetch();
    },
  });
  const getPrivateKeyMutation = trpc.wallet.getMainPrivateKey.useMutation();
  const updateNameMutation = trpc.auth.updateName.useMutation();

  const [isEditingName, setIsEditingName] = useState(false);
  const [nameValue, setNameValue] = useState("");
  const [privateKeyDialogOpen, setPrivateKeyDialogOpen] = useState(false);
  const [privateKey, setPrivateKey] = useState<string | null>(null);
  const [sendDialogOpen, setSendDialogOpen] = useState(false);
  const [depositDialogOpen, setDepositDialogOpen] = useState(false);
  const [withdrawDialogOpen, setWithdrawDialogOpen] = useState(false);

  const wallet = mainWalletQuery.data;
  const balanceSol = Number(wallet?.balanceSol ?? 0);

  const handleStartEditName = () => {
    setNameValue(currentUser?.name ?? "");
    setIsEditingName(true);
  };

  const handleCancelEditName = () => {
    setIsEditingName(false);
    setNameValue("");
  };

  const handleSaveName = async () => {
    const trimmed = nameValue.trim();
    if (!trimmed) {
      toast.error("Name cannot be empty");
      return;
    }
    if (trimmed === currentUser?.name) {
      setIsEditingName(false);
      return;
    }
    try {
      await updateNameMutation.mutateAsync({ name: trimmed });
      toast.success("Name updated");
      setIsEditingName(false);
      utils.auth.me.invalidate();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to update name";
      toast.error(message);
    }
  };

  const handleRefresh = async () => {
    const toastId = toast.loading("Refreshing wallet balance...", {
      icon: <Spinner className="size-4" />,
    });
    try {
      await refreshMainBalance.mutateAsync({});
      toast.success("Wallet balance refreshed", { id: toastId, icon: null });
    } catch {
      toast.error("Failed to refresh wallet balance", {
        id: toastId,
        icon: null,
      });
    }
  };

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
        <Skeleton className="h-10 w-48" />
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
      <PageHeader
        title={
          isEditingName ? (
            <div className="flex items-center gap-2">
              <Input
                value={nameValue}
                onChange={(e) => setNameValue(e.target.value)}
                className="h-10 w-full max-w-xs text-xl font-medium md:text-2xl"
                maxLength={50}
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleSaveName();
                  if (e.key === "Escape") handleCancelEditName();
                }}
                disabled={updateNameMutation.isPending}
              />
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={handleSaveName}
                disabled={updateNameMutation.isPending}
              >
                {updateNameMutation.isPending ? (
                  <Spinner className="size-4" />
                ) : (
                  <IconCheck className="size-4" />
                )}
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={handleCancelEditName}
                disabled={updateNameMutation.isPending}
              >
                <IconX className="size-4" />
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-4">
              <h1 className="truncate text-2xl leading-tight md:text-4xl">
                {currentUser.name || "Account"}
              </h1>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-8 w-8 text-muted-foreground hover:text-foreground"
                    onClick={handleStartEditName}
                  >
                    <IconPencil className="size-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Edit Name</TooltipContent>
              </Tooltip>
            </div>
          )
        }
        rightContent={
          <div className="flex w-full flex-col items-start gap-3 md:items-end md:gap-4">
            <div className="text-left md:text-right">
              <p className="text-xs uppercase tracking-tighter font-mono font-semibold text-muted-foreground">
                WALLET BALANCE
              </p>
              <p className="font-mono leading-none">
                <span className="text-2xl md:text-4xl">
                  {balanceSol.toFixed(4)}
                </span>{" "}
                <span className="text-base text-muted-foreground">SOL</span>
              </p>
            </div>
            <div className="flex w-full flex-wrap items-center gap-2 md:w-auto md:justify-end md:gap-3">
              <p className="text-sm text-muted-foreground">
                Last refresh: {formatRefreshTime(wallet?.balanceRefreshedAt)}
              </p>
              <Button
                variant="outline"
                size="sm"
                onClick={handleRefresh}
                disabled={refreshMainBalance.isPending}
              >
                {refreshMainBalance.isPending ? (
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

      {/* Wallet info */}
      <div className="flex flex-col gap-6 pt-6 md:pt-8 lg:flex-row lg:items-start lg:justify-between">
        <div className="space-y-6">
          <div className="space-y-2">
            <p className="text-xs uppercase tracking-tighter font-mono font-semibold text-muted-foreground">
              WALLET PUBLIC KEY
            </p>
            <div className="flex items-center gap-1.5">
              <code className="font-mono text-base text-muted-foreground tracking-tighter break-all sm:text-lg md:text-xl">
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
                <IconExternalLink className="size-4" />
                View on Solscan
              </Link>
            </Button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 lg:justify-end">
          <Button variant="outline" size="lg" asChild>
            <Link href="/account/subscription">Manage Subscription</Link>
          </Button>
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
