"use client";

import Link from "next/link";
import { trpc } from "@/lib/trpc/client";
import { OpsLaunchesTable } from "@/components/ops/ops-launches-table";
import { OpsRevealButton } from "@/components/ops/ops-reveal-button";
import { OpsTokensTable } from "@/components/ops/ops-tokens-table";
import { OpsWalletsTable } from "@/components/ops/ops-wallets-table";

type OpsUserSpineProps = {
  userId: string;
};

function formatDate(value: Date | string | null | undefined) {
  if (!value) return "—";
  return new Date(value).toLocaleString();
}

export function OpsUserSpine({ userId }: OpsUserSpineProps) {
  const { data, isLoading, error } = trpc.ops.getUserSpine.useQuery(
    { userId },
    { retry: false }
  );

  if (isLoading) {
    return <p className="text-muted-foreground text-sm">Loading User…</p>;
  }

  if (error || !data) {
    return (
      <p className="text-destructive text-sm">{error?.message ?? "Not found"}</p>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-2">
        <h1 className="text-xl font-semibold tracking-tight">User</h1>
        <dl className="grid gap-2 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-muted-foreground">id</dt>
            <dd className="font-mono break-all">{data.id}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">name</dt>
            <dd>{data.name}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">main wallet</dt>
            <dd className="flex flex-wrap items-center gap-2">
              <Link
                href={`/ops/wallets/${encodeURIComponent(data.mainWalletPublicKey)}`}
                className="font-mono break-all underline-offset-4 hover:underline"
              >
                {data.mainWalletPublicKey}
              </Link>
              <OpsRevealButton
                targetType="wallet"
                publicKey={data.mainWalletPublicKey}
                label="Reveal MAIN"
              />
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">plan</dt>
            <dd>{data.plan}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">paid plan started</dt>
            <dd>{formatDate(data.paidPlanStartedAt)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">paid plan expires</dt>
            <dd>{formatDate(data.paidPlanExpiresAt)}</dd>
          </div>
        </dl>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-base font-semibold">Tokens</h2>
        <OpsTokensTable userId={userId} embedded />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-base font-semibold">Launches</h2>
        <OpsLaunchesTable userId={userId} embedded />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-base font-semibold">Wallets</h2>
        <OpsWalletsTable userId={userId} embedded />
      </section>
    </div>
  );
}
