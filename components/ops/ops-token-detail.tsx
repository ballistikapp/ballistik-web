"use client";

import Link from "next/link";
import { OpsRevealButton } from "@/components/ops/ops-reveal-button";
import { trpc } from "@/lib/trpc/client";

type OpsTokenDetailProps = {
  publicKey: string;
};

function formatDate(value: Date | string | null | undefined) {
  if (!value) return "—";
  return new Date(value).toLocaleString();
}

export function OpsTokenDetail({ publicKey }: OpsTokenDetailProps) {
  const { data, isLoading, error } = trpc.ops.getToken.useQuery(
    { publicKey },
    { retry: false }
  );

  if (isLoading) {
    return <p className="text-muted-foreground text-sm">Loading Token…</p>;
  }

  if (error || !data) {
    return (
      <p className="text-destructive text-sm">{error?.message ?? "Not found"}</p>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-2">
        <h1 className="text-xl font-semibold tracking-tight">Token</h1>
        <dl className="grid gap-2 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-muted-foreground">mint</dt>
            <dd className="flex flex-wrap items-center gap-2">
              <span className="font-mono break-all">{data.publicKey}</span>
              <OpsRevealButton
                targetType="mint"
                publicKey={data.publicKey}
                label="Reveal mint key"
              />
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">name</dt>
            <dd>{data.name}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">symbol</dt>
            <dd>{data.symbol}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">status</dt>
            <dd>{data.status}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">mayhem mode</dt>
            <dd>{data.isMayhemMode ? "yes" : "no"}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">description</dt>
            <dd>{data.description ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">image</dt>
            <dd className="break-all">{data.imageUrl ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">website</dt>
            <dd className="break-all">{data.websiteUrl ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">twitter</dt>
            <dd className="break-all">{data.twitterUrl ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">telegram</dt>
            <dd className="break-all">{data.telegramUrl ?? "—"}</dd>
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
              <Link
                href={`/ops/users/${data.userId}`}
                className="underline-offset-4 hover:underline"
              >
                {data.userName}
              </Link>
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">user id</dt>
            <dd className="font-mono break-all">{data.userId}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">main wallet</dt>
            <dd className="font-mono break-all">
              {data.userMainWalletPublicKey}
            </dd>
          </div>
        </dl>
      </section>
    </div>
  );
}
