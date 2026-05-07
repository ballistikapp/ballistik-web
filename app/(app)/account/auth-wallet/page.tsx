"use client";

import Link from "next/link";
import {
  IconCopy,
  IconExternalLink,
  IconShieldCheck,
  IconShieldOff,
} from "@tabler/icons-react";
import { trpc } from "@/lib/trpc/client";
import { copyToClipboard } from "@/lib/utils";
import { WalletAuthActions } from "@/components/auth/wallet-auth-actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export default function AccountAuthWalletPage() {
  const { data: currentUser, isLoading } = trpc.auth.me.useQuery();

  if (isLoading) {
    return (
      <div className="flex flex-col gap-6 pt-6 md:pt-8">
        <Skeleton className="h-6 w-24" />
        <Skeleton className="h-14 w-full max-w-xl" />
        <Skeleton className="h-20 w-full max-w-sm" />
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

  const isLinked = !!currentUser.authWalletPublicKey;

  return (
    <div className="flex flex-col gap-8 pt-6 md:pt-8">
      <div className="flex items-center gap-2.5">
        {isLinked ? (
          <>
            <IconShieldCheck className="size-5" />
            <Badge variant="default" className="rounded-full px-3">
              Linked
            </Badge>
          </>
        ) : (
          <>
            <IconShieldOff className="size-5 text-muted-foreground" />
            <Badge variant="secondary" className="rounded-full px-3">
              Not linked
            </Badge>
          </>
        )}
      </div>

      {isLinked ? (
        <div className="flex flex-col gap-6">
          <div className="space-y-3">
            <p className="text-xs uppercase tracking-tighter font-mono font-semibold text-muted-foreground">
              AUTH WALLET
            </p>
            <div className="flex items-center gap-1.5">
              <code className="break-all font-mono text-base tracking-tighter sm:text-lg md:text-2xl">
                {currentUser.authWalletPublicKey}
              </code>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 shrink-0 text-muted-foreground hover:text-foreground"
                    onClick={() =>
                      copyToClipboard(
                        currentUser.authWalletPublicKey ?? "",
                        "Auth wallet"
                      )
                    }
                  >
                    <IconCopy className="size-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Copy</TooltipContent>
              </Tooltip>
            </div>
          </div>

          <Button size="sm" variant="ghost" className="w-fit -ml-2" asChild>
            <Link
              href={`https://solscan.io/account/${currentUser.authWalletPublicKey}`}
              target="_blank"
              rel="noreferrer"
            >
              <IconExternalLink className="size-3.5" />
              View on Solscan
            </Link>
          </Button>

          <Separator />

          <p className="text-sm text-muted-foreground max-w-md">
            Used only for signing in. Your main wallet remains the operational
            wallet for all app actions.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-6 max-w-sm">
          <p className="text-sm text-muted-foreground">
            Link a connected wallet to sign in without your private key.
          </p>

          <WalletAuthActions mode="link" />

          <Separator />

          <ul className="flex flex-col gap-1.5 text-xs text-muted-foreground">
            <li>Connect your external wallet</li>
            <li>Sign a message to prove ownership</li>
            <li>Use it to log in — no private key required</li>
          </ul>
        </div>
      )}
    </div>
  );
}
