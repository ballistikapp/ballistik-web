"use client";

import * as React from "react";
import {
  IconCreditCard,
  IconDotsVertical,
  IconLogout,
  IconNotification,
  IconUserCircle,
  IconWallet,
  IconCopy,
} from "@tabler/icons-react";
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
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { AuthDialog } from "@/components/auth/auth-dialog";
import { trpc } from "@/lib/trpc/client";
import Link from "next/link";
import { copyToClipboard } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export function AuthButton() {
  const [authDialogOpen, setAuthDialogOpen] = React.useState(false);
  const { data: currentUser, isLoading } = trpc.auth.me.useQuery();

  const isLoggedIn = currentUser !== null && currentUser !== undefined;

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

  if (isLoading) {
    return (
      <Button variant="ghost" size="default" disabled>
        Loading...
      </Button>
    );
  }

  if (!isLoggedIn) {
    return (
      <>
        <Button
          variant="outline"
          size="default"
          onClick={() => setAuthDialogOpen(true)}
          className="gap-2"
        >
          <IconWallet className="size-5" />
          <span>Login</span>
        </Button>
        <AuthDialog open={authDialogOpen} onOpenChange={setAuthDialogOpen} />
      </>
    );
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="default" className="gap-2 h-10">
            <IconWallet className="size-5" />
            <span className="hidden sm:inline-block">
              {currentUser.name || "User"}
            </span>
            <IconDotsVertical className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuGroup>
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenuItem
                  className="cursor-pointer flex flex-col gap-1"
                  onClick={async () =>
                    await copyToClipboard(
                      currentUser.mainWalletPublicKey,
                      "Public Key"
                    )
                  }
                >
                  <span className="truncate text-lg font-medium">
                    {currentUser.name || "Wallet"}
                  </span>
                  <span className="text-muted-foreground truncate text-xs font-mono">
                    {truncateAddress(currentUser.mainWalletPublicKey)}
                  </span>
                </DropdownMenuItem>
              </TooltipTrigger>
              <TooltipContent>Copy Wallet Public Key</TooltipContent>
            </Tooltip>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuItem asChild>
              <Link href={`/wallets/${currentUser.mainWalletPublicKey}`}>
                <IconNotification />
                Go to Wallet Details
              </Link>
            </DropdownMenuItem>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={handleLogout}>
            <IconLogout />
            Log out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}
