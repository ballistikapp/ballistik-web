"use client";

import Link from "next/link";
import { trpc } from "@/lib/trpc/client";
import { OpsRevealButton } from "@/components/ops/ops-reveal-button";

type OpsLaunchAutopsyProps = {
  launchId: string;
};

function formatDate(value: Date | string | null | undefined) {
  if (!value) return "—";
  return new Date(value).toLocaleString();
}

export function OpsLaunchAutopsy({ launchId }: OpsLaunchAutopsyProps) {
  const { data, isLoading, error } = trpc.ops.getLaunchAutopsy.useQuery(
    { launchId },
    { retry: false }
  );

  if (isLoading) {
    return <p className="text-muted-foreground text-sm">Loading Launch…</p>;
  }

  if (error || !data) {
    return (
      <p className="text-destructive text-sm">{error?.message ?? "Not found"}</p>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-xl font-semibold tracking-tight">
            Launch autopsy
          </h1>
          <Link
            href={`/ops/users/${data.userId}`}
            className="text-muted-foreground text-xs underline-offset-4 hover:underline"
          >
            Back to User
          </Link>
        </div>
        <dl className="grid gap-2 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-muted-foreground">id</dt>
            <dd className="font-mono break-all">{data.id}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">status</dt>
            <dd>{data.status}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">platform</dt>
            <dd>{data.platform ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">platform version</dt>
            <dd>
              {data.platformVersion ?? "—"}
              {data.isLegacy ? (
                <span className="text-muted-foreground ml-2 text-xs">
                  legacy
                </span>
              ) : null}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">plan</dt>
            <dd>
              {data.hasPlan
                ? `present${data.planSchemaVersion ? ` (schema ${data.planSchemaVersion})` : ""}`
                : "none"}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">outcome</dt>
            <dd>{data.outcomeKind ?? "—"}</dd>
          </div>
          {data.isLegacy ? (
            <div>
              <dt className="text-muted-foreground">retry / clone</dt>
              <dd>unavailable (legacy)</dd>
            </div>
          ) : null}
          <div>
            <dt className="text-muted-foreground">progress</dt>
            <dd>{data.progress}%</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">current step</dt>
            <dd>{data.currentStep ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">started</dt>
            <dd>{formatDate(data.startedAt)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">completed</dt>
            <dd>{formatDate(data.completedAt)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">cancel requested</dt>
            <dd>{formatDate(data.cancelRequestedAt)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">token</dt>
            <dd className="flex flex-wrap items-center gap-2">
              <span className="font-mono break-all">
                {data.tokenPublicKey ?? "—"}
              </span>
              {data.tokenPublicKey ? (
                <OpsRevealButton
                  targetType="mint"
                  publicKey={data.tokenPublicKey}
                  label="Reveal mint"
                />
              ) : null}
            </dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="text-muted-foreground">error</dt>
            <dd className="whitespace-pre-wrap">{data.errorMessage ?? "—"}</dd>
          </div>
        </dl>
      </section>

      {data.hasPlan && !data.planSummaryAvailable ? (
        <section className="flex flex-col gap-2">
          <h2 className="text-base font-semibold">Plan summary</h2>
          <p className="text-muted-foreground text-sm">
            A plan is persisted but could not be projected safely (invalid or
            unsupported schema). Opaque payload is omitted.
          </p>
        </section>
      ) : null}

      {data.planSummary ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-base font-semibold">Plan summary</h2>
          <p className="text-muted-foreground text-xs">
            Normalized monetary summary and Platform operational details.
            Opaque plan payload is omitted.
            {data.planPersistedAt
              ? ` Persisted ${formatDate(data.planPersistedAt)}.`
              : ""}
          </p>
          <pre className="bg-muted overflow-x-auto rounded-md p-3 text-xs">
            {JSON.stringify(data.planSummary, null, 2)}
          </pre>
        </section>
      ) : null}

      <section className="flex flex-col gap-3">
        <h2 className="text-base font-semibold">Jito diagnostics</h2>
        {data.jitoDiagnostics.eventCount === 0 ? (
          <p className="text-muted-foreground text-sm">
            No Jito telemetry on this Launch.
          </p>
        ) : (
          <dl className="grid gap-2 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-muted-foreground">events</dt>
              <dd>{data.jitoDiagnostics.eventCount}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">last event</dt>
              <dd>{data.jitoDiagnostics.lastEventType ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">last failure</dt>
              <dd>{data.jitoDiagnostics.lastFailureType ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">tip lamports</dt>
              <dd>{data.jitoDiagnostics.tipLamports ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">resends / rebuilds</dt>
              <dd>
                {data.jitoDiagnostics.resendCount} /{" "}
                {data.jitoDiagnostics.rebuildCount}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">bundle ids</dt>
              <dd className="font-mono break-all">
                {data.jitoDiagnostics.bundleIds.length > 0
                  ? data.jitoDiagnostics.bundleIds.join(", ")
                  : "—"}
              </dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-muted-foreground">endpoints</dt>
              <dd className="font-mono break-all text-xs">
                {data.jitoDiagnostics.endpoints.length > 0
                  ? data.jitoDiagnostics.endpoints.join(", ")
                  : "—"}
              </dd>
            </div>
            {data.jitoDiagnostics.confirmation ? (
              <div className="sm:col-span-2">
                <dt className="text-muted-foreground">confirmation</dt>
                <dd className="font-mono text-xs">
                  found={data.jitoDiagnostics.confirmation.foundCount ?? "—"}{" "}
                  confirmed=
                  {data.jitoDiagnostics.confirmation.confirmedCount ?? "—"}{" "}
                  failed={data.jitoDiagnostics.confirmation.failedCount ?? "—"}{" "}
                  notFound=
                  {data.jitoDiagnostics.confirmation.notFoundCount ?? "—"}{" "}
                  createStatus=
                  {data.jitoDiagnostics.confirmation.createStatus ?? "—"}
                </dd>
              </div>
            ) : null}
          </dl>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-base font-semibold">Launch log timeline</h2>
        {data.logs.length === 0 ? (
          <p className="text-muted-foreground text-sm">No logs.</p>
        ) : (
          <ol className="flex flex-col gap-3">
            {data.logs.map((log) => (
              <li
                key={log.id}
                className="border-border/60 border-l-2 pl-3 text-sm"
              >
                <div className="text-muted-foreground flex flex-wrap gap-x-3 gap-y-1 text-xs">
                  <span>{formatDate(log.createdAt)}</span>
                  <span>{log.level}</span>
                  {log.step ? <span>{log.step}</span> : null}
                </div>
                <p className="mt-1">{log.message}</p>
                {log.data != null ? (
                  <pre className="bg-muted mt-2 overflow-x-auto rounded-md p-2 text-xs">
                    {JSON.stringify(log.data, null, 2)}
                  </pre>
                ) : null}
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
