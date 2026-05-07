"use client";

import * as React from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import {
  IconArrowDownLeft,
  IconArrowUpRight,
  IconDotsVertical,
  IconLogout,
  IconCopy,
  IconRefresh,
  IconWallet,
} from "@tabler/icons-react";
import Link from "next/link";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { trpc } from "@/lib/trpc/client";
import { cacheConfig } from "@/lib/config/cache.config";
import { copyToClipboard } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Spinner } from "@/components/ui/spinner";
import { MainWalletDepositDialog } from "@/components/wallets/main-wallet-deposit-dialog";
import { MainWalletWithdrawDialog } from "@/components/wallets/main-wallet-withdraw-dialog";
import { Badge } from "@/components/ui/badge";

export function AuthButton() {
  const [depositDialogOpen, setDepositDialogOpen] = React.useState(false);
  const [withdrawDialogOpen, setWithdrawDialogOpen] = React.useState(false);
  const { disconnect: disconnectAdapter } = useWallet();
  const { data: currentUser, isLoading } = trpc.auth.me.useQuery();
  const isLoggedIn = currentUser !== null && currentUser !== undefined;
  const mainWalletQuery = trpc.wallet.getMain.useQuery(
    {},
    {
      enabled: isLoggedIn,
      staleTime: cacheConfig.staleMs.wallets,
    }
  );
  const subscriptionOverviewQuery =
    trpc.billing.getSubscriptionOverview.useQuery(
      {},
      {
        enabled: isLoggedIn,
      }
    );
  const refreshMainBalance = trpc.wallet.refreshMainBalance.useMutation({
    onSuccess: () => {
      mainWalletQuery.refetch();
    },
  });
  const mainWalletBalanceSol = Number(mainWalletQuery.data?.balanceSol ?? 0);
  const subscriptionOverview = subscriptionOverviewQuery.data;
  const effectivePlan = subscriptionOverview?.plan ?? currentUser?.plan ?? null;
  const isPaidPlan = effectivePlan === "PRO" || effectivePlan === "DEVELOPER";

  const logoutMutation = trpc.auth.logout.useMutation({
    onSuccess: async () => {
      try {
        await disconnectAdapter();
      } catch {
        // Adapter cleanup is best-effort; ignore failures.
      }
      window.location.reload();
    },
    onError: (error) => {
      console.error("Logout error:", error);
    },
  });

  const handleLogout = () => {
    logoutMutation.mutate();
  };

  const truncateAddress = (address: string) => {
    if (address.length <= 12) return address;
    return `${address.slice(0, 6)}...${address.slice(-6)}`;
  };

  const handleRefreshMainBalance = async (
    event: React.MouseEvent<HTMLButtonElement>
  ) => {
    event.preventDefault();
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

  if (isLoading) {
    return (
      <Button variant="ghost" size="default" disabled>
        Loading...
      </Button>
    );
  }

  if (!isLoggedIn) {
    return (
      <Button variant="outline" size="default" className="gap-2" asChild>
        <Link href="/auth">
          <IconWallet className="size-5" />
          <span>Login</span>
        </Link>
      </Button>
    );
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="default"
            className="h-12 gap-3 px-3 rounded-xl hover:bg-muted/10"
          >
            <span className="flex size-8 items-center justify-center rounded-full bg-muted">
              <IconWallet className="size-4" />
            </span>
            <span className="hidden sm:flex flex-col items-start leading-none">
              <span className="text-sm font-medium">
                {currentUser.name || "User"}
              </span>
              <span className="text-xs text-muted-foreground">
                {mainWalletBalanceSol.toFixed(4)} SOL
              </span>
            </span>
            <IconDotsVertical className="size-4 ml-4 text-muted-foreground" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuLabel className="flex flex-col">
            <span>Main Wallet</span>
            <div className="h-1" />
            <div className="flex items-center justify-between gap-3">
              <span className="truncate font-mono text-xs text-muted-foreground">
                {truncateAddress(currentUser.mainWalletPublicKey)}
              </span>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="text-muted-foreground hover:bg-transparent hover:text-foreground"
                    onClick={async (event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      await copyToClipboard(
                        currentUser.mainWalletPublicKey,
                        "Public Key"
                      );
                    }}
                  >
                    <IconCopy />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Copy Wallet Public Key</TooltipContent>
              </Tooltip>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-lg font-mono font-semibold text-foreground">
                {mainWalletBalanceSol.toFixed(4)} SOL
              </span>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="text-muted-foreground hover:bg-transparent hover:text-foreground"
                    disabled={refreshMainBalance.isPending}
                    onClick={handleRefreshMainBalance}
                  >
                    {refreshMainBalance.isPending ? (
                      <Spinner className="size-4" />
                    ) : (
                      <IconRefresh />
                    )}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Refresh</TooltipContent>
              </Tooltip>
            </div>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />

          <DropdownMenuGroup>
            <DropdownMenuItem
              onSelect={(event) => {
                event.preventDefault();
                setDepositDialogOpen(true);
              }}
            >
              <IconArrowDownLeft />
              Deposit
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={(event) => {
                event.preventDefault();
                setWithdrawDialogOpen(true);
              }}
            >
              <IconArrowUpRight />
              Withdraw
            </DropdownMenuItem>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuItem asChild>
              <Link href="/account">
                <IconWallet />
                Go to Account
                {effectivePlan ? (
                  <Badge
                    variant={isPaidPlan ? "default" : "secondary"}
                    className="ml-auto"
                  >
                    {effectivePlan === "PRO"
                      ? "Pro"
                      : effectivePlan === "DEVELOPER"
                        ? "Developer"
                        : "Free"}
                  </Badge>
                ) : null}
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={handleLogout}>
              <IconLogout />
              Log out
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>

      <MainWalletDepositDialog
        open={depositDialogOpen}
        onOpenChange={setDepositDialogOpen}
        publicKey={currentUser.mainWalletPublicKey}
      />
      <MainWalletWithdrawDialog
        open={withdrawDialogOpen}
        onOpenChange={setWithdrawDialogOpen}
        balanceSol={mainWalletBalanceSol}
      />
    </>
  );
}
