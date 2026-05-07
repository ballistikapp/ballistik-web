"use client";

import { useState } from "react";
import Link from "next/link";
import { IconCheck, IconPencil, IconRefresh, IconX } from "@tabler/icons-react";
import { toast } from "sonner";
import { cacheConfig } from "@/lib/config/cache.config";
import { trpc } from "@/lib/trpc/client";
import { formatRefreshTime } from "@/lib/utils/relative-time";
import { PageHeader } from "@/components/layout/sections";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export function AccountLayoutHeader() {
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
  const updateNameMutation = trpc.auth.updateName.useMutation();

  const [isEditingName, setIsEditingName] = useState(false);
  const [nameValue, setNameValue] = useState("");

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

  if (userLoading) {
    return (
      <PageHeader
        title={<Skeleton className="h-10 w-48" />}
        rightContent={
          <div className="flex w-full flex-col items-start gap-3 md:items-end">
            <Skeleton className="h-12 w-36" />
            <Skeleton className="h-9 w-56" />
          </div>
        }
      />
    );
  }

  if (!currentUser) {
    return (
      <PageHeader
        title="Account"
        rightContent={
          <Button asChild>
            <Link href="/auth">Log in</Link>
          </Button>
        }
      />
    );
  }

  return (
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
              {currentUser.name || "Main Wallet"}
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
              MAIN WALLET BALANCE
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
  );
}
