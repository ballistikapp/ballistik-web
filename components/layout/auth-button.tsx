"use client";

import * as React from "react";
import { format } from "date-fns";
import {
  IconArrowDownLeft,
  IconArrowUpRight,
  IconCreditCard,
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
  const isProPlan = effectivePlan === "PRO";
  const proExpiresAtLabel = subscriptionOverview?.proExpiresAt
    ? format(new Date(subscriptionOverview.proExpiresAt), "MMM d, yyyy")
    : null;

  const logoutMutation = trpc.auth.logout.useMutation({
    onSuccess: () => {
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
          <DropdownMenuGroup>
            <DropdownMenuItem className="cursor-default data-highlighted:bg-transparent data-highlighted:text-foreground">
              <div className="flex w-full items-center justify-between gap-3">
                <div className="flex min-w-0 flex-col gap-1">
                  <span className="truncate text-sm font-medium">
                    {currentUser.name || "Wallet"}
                  </span>
                  <span className="text-muted-foreground truncate text-xs font-mono">
                    {truncateAddress(currentUser.mainWalletPublicKey)}
                  </span>
                </div>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-muted-foreground hover:bg-transparent hover:text-foreground"
                      onClick={async (event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        await copyToClipboard(
                          currentUser.mainWalletPublicKey,
                          "Public Key"
                        );
                      }}
                    >
                      <IconCopy className="size-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Copy Wallet Public Key</TooltipContent>
                </Tooltip>
              </div>
            </DropdownMenuItem>
          </DropdownMenuGroup>

          <DropdownMenuSeparator />

          <DropdownMenuLabel className="flex items-center justify-between gap-3">
            <div className="flex flex-col">
              <span className="text-xs text-muted-foreground">Balance</span>
              <span className="text-lg font-mono font-semibold">
                {mainWalletBalanceSol.toFixed(4)} SOL
              </span>
            </div>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-muted-foreground hover:bg-transparent hover:text-foreground"
                  disabled={refreshMainBalance.isPending}
                  onClick={handleRefreshMainBalance}
                >
                  {refreshMainBalance.isPending ? (
                    <Spinner className="size-4" />
                  ) : (
                    <IconRefresh className="size-4" />
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent>Refresh</TooltipContent>
            </Tooltip>
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
            <DropdownMenuItem asChild>
              <Link href="/account">
                <IconWallet />
                Go to Main Wallet
              </Link>
            </DropdownMenuItem>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          {effectivePlan ? (
            <>
              <DropdownMenuLabel className="flex flex-col gap-1">
                <div>
                  <Badge variant={isProPlan ? "default" : "secondary"}>
                    {isProPlan ? "Pro Plan" : "Free Plan"}
                  </Badge>
                </div>
                {isProPlan && proExpiresAtLabel ? (
                  <span className="text-xs text-muted-foreground">
                    Active until {proExpiresAtLabel}
                  </span>
                ) : null}
              </DropdownMenuLabel>
              <DropdownMenuItem asChild>
                <Link href="/account/subscription">
                  <IconCreditCard />
                  {isProPlan ? "Manage Subscription" : "Upgrade to Pro Plan"}
                </Link>
              </DropdownMenuItem>

              <DropdownMenuSeparator />
            </>
          ) : null}

          <DropdownMenuItem onClick={handleLogout}>
            <IconLogout />
            Log out
          </DropdownMenuItem>
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
