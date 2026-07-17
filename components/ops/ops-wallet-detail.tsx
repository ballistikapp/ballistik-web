"use client";

import Link from "next/link";
import { IconRefresh } from "@tabler/icons-react";
import { toast } from "sonner";
import { OpsRevealButton } from "@/components/ops/ops-reveal-button";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { trpc } from "@/lib/trpc/client";

type OpsWalletDetailProps = {
  publicKey: string;
};

function formatDate(value: Date | string | null | undefined) {
  if (!value) return "—";
  return new Date(value).toLocaleString();
}

export function OpsWalletDetail({ publicKey }: OpsWalletDetailProps) {
  const utils = trpc.useUtils();
  const { data, isLoading, error } = trpc.ops.getWallet.useQuery(
    { publicKey },
    { retry: false }
  );

  const refreshMutation = trpc.ops.refreshWalletBalances.useMutation({
    onSuccess: async (result) => {
      await Promise.all([
        utils.ops.getWallet.invalidate({ publicKey }),
        utils.ops.listWallets.invalidate(),
      ]);
      toast.success(
        result.refreshedCount === 1
          ? "Wallet balance refreshed"
          : `${result.refreshedCount} Wallet balances refreshed`
      );
    },
    onError: (refreshError) => {
      toast.error(refreshError.message || "Failed to refresh Wallet balance");
    },
  });

  if (isLoading) {
    return <p className="text-muted-foreground text-sm">Loading Wallet…</p>;
  }

  if (error || !data) {
    return (
      <p className="text-destructive text-sm">{error?.message ?? "Not found"}</p>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-xl font-semibold tracking-tight">Wallet</h1>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={refreshMutation.isPending}
            onClick={() =>
              refreshMutation.mutate({ publicKeys: [data.publicKey] })
            }
          >
            {refreshMutation.isPending ? (
              <Spinner className="size-4" />
            ) : (
              <IconRefresh className="size-4" />
            )}
            Refresh balance
          </Button>
        </div>
        <dl className="grid gap-2 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-muted-foreground">pubkey</dt>
            <dd className="flex flex-wrap items-center gap-2">
              <span className="font-mono break-all">{data.publicKey}</span>
              <OpsRevealButton
                targetType="wallet"
                publicKey={data.publicKey}
              />
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">type</dt>
            <dd>{data.type}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">system</dt>
            <dd>{data.isSystemWallet ? "yes" : "no"}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">imported</dt>
            <dd>{data.isImported ? "yes" : "no"}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">SOL balance</dt>
            <dd>{data.balanceSol.toFixed(4)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">balance refreshed</dt>
            <dd>{formatDate(data.balanceRefreshedAt)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">created</dt>
            <dd>{formatDate(data.createdAt)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">updated</dt>
            <dd>{formatDate(data.updatedAt)}</dd>
          </div>
        </dl>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-base font-semibold">Owner</h2>
        <dl className="grid gap-2 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-muted-foreground">user</dt>
            <dd>
              {data.userId ? (
                <Link
                  href={`/ops/users/${data.userId}`}
                  className="underline-offset-4 hover:underline"
                >
                  {data.userName ?? data.userId}
                </Link>
              ) : (
                "—"
              )}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">user id</dt>
            <dd className="font-mono break-all">{data.userId ?? "—"}</dd>
          </div>
        </dl>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-base font-semibold">Token</h2>
        <dl className="grid gap-2 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-muted-foreground">mint</dt>
            <dd>
              {data.tokenPublicKey ? (
                <Link
                  href={`/ops/tokens/${encodeURIComponent(data.tokenPublicKey)}`}
                  className="font-mono break-all underline-offset-4 hover:underline"
                >
                  {data.tokenPublicKey}
                </Link>
              ) : (
                "—"
              )}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">name</dt>
            <dd>{data.tokenName ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">symbol</dt>
            <dd>{data.tokenSymbol ?? "—"}</dd>
          </div>
        </dl>
      </section>
    </div>
  );
}
