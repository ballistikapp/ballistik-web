"use client";

import Link from "next/link";
import { trpc } from "@/lib/trpc/client";
import { OpsRevealButton } from "@/components/ops/ops-reveal-button";

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
              <span className="font-mono break-all">
                {data.mainWalletPublicKey}
              </span>
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
        {data.tokens.length === 0 ? (
          <p className="text-muted-foreground text-sm">No tokens.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-muted-foreground border-b">
                <tr>
                  <th className="py-2 pr-3 font-medium">mint</th>
                  <th className="py-2 pr-3 font-medium">name</th>
                  <th className="py-2 pr-3 font-medium">symbol</th>
                  <th className="py-2 pr-3 font-medium">status</th>
                  <th className="py-2 font-medium">key</th>
                </tr>
              </thead>
              <tbody>
                {data.tokens.map((token) => (
                  <tr key={token.publicKey} className="border-b border-border/60">
                    <td className="py-2 pr-3 font-mono text-xs break-all">
                      {token.publicKey}
                    </td>
                    <td className="py-2 pr-3">{token.name}</td>
                    <td className="py-2 pr-3">{token.symbol}</td>
                    <td className="py-2 pr-3">{token.status}</td>
                    <td className="py-2">
                      <OpsRevealButton
                        targetType="mint"
                        publicKey={token.publicKey}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-base font-semibold">Launches</h2>
        {data.launches.length === 0 ? (
          <p className="text-muted-foreground text-sm">No launches.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-muted-foreground border-b">
                <tr>
                  <th className="py-2 pr-3 font-medium">id</th>
                  <th className="py-2 pr-3 font-medium">status</th>
                  <th className="py-2 pr-3 font-medium">progress</th>
                  <th className="py-2 pr-3 font-medium">step</th>
                  <th className="py-2 pr-3 font-medium">token</th>
                  <th className="py-2 pr-3 font-medium">started</th>
                  <th className="py-2 font-medium">completed</th>
                </tr>
              </thead>
              <tbody>
                {data.launches.map((launch) => (
                  <tr key={launch.id} className="border-b border-border/60">
                    <td className="py-2 pr-3">
                      <Link
                        href={`/ops/launches/${launch.id}`}
                        className="font-mono text-xs underline-offset-4 hover:underline"
                      >
                        {launch.id}
                      </Link>
                    </td>
                    <td className="py-2 pr-3">{launch.status}</td>
                    <td className="py-2 pr-3">{launch.progress}%</td>
                    <td className="py-2 pr-3">{launch.currentStep ?? "—"}</td>
                    <td className="py-2 pr-3 font-mono text-xs break-all">
                      {launch.tokenPublicKey ?? "—"}
                    </td>
                    <td className="py-2 pr-3">{formatDate(launch.startedAt)}</td>
                    <td className="py-2">{formatDate(launch.completedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-base font-semibold">Wallets</h2>
        {data.wallets.length === 0 ? (
          <p className="text-muted-foreground text-sm">No wallets.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-muted-foreground border-b">
                <tr>
                  <th className="py-2 pr-3 font-medium">type</th>
                  <th className="py-2 pr-3 font-medium">pubkey</th>
                  <th className="py-2 pr-3 font-medium">SOL</th>
                  <th className="py-2 pr-3 font-medium">refreshed</th>
                  <th className="py-2 font-medium">key</th>
                </tr>
              </thead>
              <tbody>
                {data.wallets.map((wallet) => (
                  <tr
                    key={wallet.publicKey}
                    className="border-b border-border/60"
                  >
                    <td className="py-2 pr-3">{wallet.type}</td>
                    <td className="py-2 pr-3 font-mono text-xs break-all">
                      {wallet.publicKey}
                    </td>
                    <td className="py-2 pr-3">
                      {wallet.balanceSol.toFixed(4)}
                    </td>
                    <td className="py-2 pr-3">
                      {formatDate(wallet.balanceRefreshedAt)}
                    </td>
                    <td className="py-2">
                      <OpsRevealButton
                        targetType="wallet"
                        publicKey={wallet.publicKey}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
