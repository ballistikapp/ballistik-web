"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef } from "react";
import { format } from "date-fns";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc/client";
import { PageHeader } from "@/components/layout/sections";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Skeleton } from "@/components/ui/skeleton";

function formatDateTime(value: Date | string | null | undefined) {
  if (!value) {
    return "—";
  }

  const date = typeof value === "string" ? new Date(value) : value;
  return format(date, "MMM d, yyyy 'at' HH:mm");
}

function formatSignature(signature: string) {
  return `${signature.slice(0, 8)}...${signature.slice(-8)}`;
}

export default function AccountSubscriptionPage() {
  const utils = trpc.useUtils();
  const refreshTriggeredRef = useRef(false);

  const overviewQuery = trpc.billing.getSubscriptionOverview.useQuery({});
  const historyQuery = trpc.billing.getHistory.useQuery({ limit: 20 });
  const refreshSessionMutation = trpc.auth.refreshSession.useMutation();
  const purchaseMutation = trpc.billing.purchaseWeeklyPro.useMutation();

  const overview = overviewQuery.data;
  const history = historyQuery.data ?? [];
  const isBusy =
    purchaseMutation.isPending || refreshSessionMutation.isPending;

  useEffect(() => {
    if (!overview?.requiresTokenRefresh || refreshTriggeredRef.current) {
      return;
    }

    refreshTriggeredRef.current = true;

    refreshSessionMutation
      .mutateAsync({})
      .then(async () => {
        await Promise.all([
          utils.auth.me.invalidate(),
          utils.billing.getSubscriptionOverview.invalidate(),
        ]);
      })
      .catch((error) => {
        refreshTriggeredRef.current = false;
        toast.error(
          error instanceof Error
            ? error.message
            : "Failed to refresh session"
        );
      });
  }, [overview?.requiresTokenRefresh, refreshSessionMutation, utils.auth.me, utils.billing.getSubscriptionOverview]);

  const ctaLabel = useMemo(() => {
    if (overview?.status === "ACTIVE") {
      return "Extend Pro by 7 days";
    }
    if (overview?.status === "EXPIRED") {
      return "Renew Pro";
    }
    return "Upgrade to Pro";
  }, [overview?.status]);

  const handlePurchase = async () => {
    try {
      const result = await purchaseMutation.mutateAsync({});
      let refreshFailed = false;
      try {
        await refreshSessionMutation.mutateAsync({});
      } catch {
        refreshFailed = true;
      }
      await Promise.all([
        utils.auth.me.invalidate(),
        utils.billing.getSubscriptionOverview.invalidate(),
        utils.billing.getHistory.invalidate(),
        utils.wallet.getMain.invalidate(),
      ]);
      toast.success(
        refreshFailed
          ? `Payment confirmed. Refresh your session to see Pro access until ${formatDateTime(result.proExpiresAt)}.`
          : `Pro is active until ${formatDateTime(result.proExpiresAt)}`
      );
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to purchase Pro"
      );
    }
  };

  if (overviewQuery.isLoading) {
    return (
      <div className="flex flex-col gap-6">
        <Skeleton className="h-10 w-56" />
        <Skeleton className="h-48 w-full rounded-xl" />
        <Skeleton className="h-72 w-full rounded-xl" />
      </div>
    );
  }

  if (!overview) {
    return (
      <div className="flex flex-col gap-4 py-10">
        <PageHeader title="Subscription" />
        <p className="text-sm text-muted-foreground">
          Subscription details are unavailable right now.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Subscription"
        rightContent={
          <p className="max-w-sm text-sm text-muted-foreground">
            Manage your weekly Pro access and review recent billing activity.
          </p>
        }
      />

      <section className="grid gap-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
        <div className="rounded-2xl border bg-card p-6">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <span className="rounded-full bg-muted px-3 py-1 text-xs uppercase tracking-wide text-muted-foreground">
                  {overview.plan === "PRO" ? "Pro" : "Free"}
                </span>
                <span className="rounded-full border px-3 py-1 text-xs uppercase tracking-wide text-muted-foreground">
                  {overview.status}
                </span>
              </div>
              <h2 className="text-2xl font-semibold">Weekly Pro</h2>
              <p className="text-sm text-muted-foreground">
                Pro unlocks live monitoring, faster gRPC-backed tooling, and
                zero platform fees on supported flows.
              </p>
            </div>
            <div className="text-right">
              <div className="text-xs uppercase tracking-wide text-muted-foreground">
                Public price
              </div>
              <div className="text-3xl font-semibold">
                {overview.priceSol.toFixed(2)} SOL
              </div>
              <div className="text-sm text-muted-foreground">per 7 days</div>
            </div>
          </div>

          <div className="mt-6 grid gap-4 md:grid-cols-2">
            <div className="rounded-xl border bg-muted/30 p-4">
              <div className="text-xs uppercase tracking-wide text-muted-foreground">
                Current status
              </div>
              <div className="mt-2 text-lg font-medium">
                {overview.status === "ACTIVE"
                  ? "Active"
                  : overview.status === "EXPIRED"
                    ? "Expired"
                    : "Free plan"}
              </div>
            </div>
            <div className="rounded-xl border bg-muted/30 p-4">
              <div className="text-xs uppercase tracking-wide text-muted-foreground">
                Expires
              </div>
              <div className="mt-2 text-lg font-medium">
                {formatDateTime(overview.proExpiresAt)}
              </div>
            </div>
          </div>

          <div className="mt-6 space-y-2 text-sm text-muted-foreground">
            <p>
              Pro removes platform fees only. Network, protocol, rent, and Jito
              costs still apply when relevant.
            </p>
            <p>
              There is no auto-renewal. When your period ends, you can renew
              from this page.
            </p>
          </div>

          <div className="mt-6 flex flex-wrap gap-3">
            <Button onClick={handlePurchase} disabled={isBusy}>
              {isBusy ? (
                <>
                  <Spinner className="mr-2 size-4" />
                  Processing...
                </>
              ) : (
                ctaLabel
              )}
            </Button>
            <Button variant="outline" asChild>
              <Link href="/account">Back to account</Link>
            </Button>
          </div>
        </div>

        <div className="rounded-2xl border bg-card p-6">
          <div className="space-y-2">
            <h3 className="text-lg font-semibold">What Pro includes</h3>
            <ul className="space-y-2 text-sm text-muted-foreground">
              <li>Live monitoring on the dashboard.</li>
              <li>Faster gRPC-backed confirmation paths where supported.</li>
              <li>No platform fees on supported launch and volume-bot flows.</li>
            </ul>
          </div>
        </div>
      </section>

      <section className="rounded-2xl border bg-card p-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h3 className="text-lg font-semibold">Billing history</h3>
            <p className="text-sm text-muted-foreground">
              Recent weekly Pro purchases charged from your main wallet.
            </p>
          </div>
        </div>

        {historyQuery.isLoading ? (
          <div className="mt-6 grid gap-3">
            <Skeleton className="h-16 w-full rounded-xl" />
            <Skeleton className="h-16 w-full rounded-xl" />
          </div>
        ) : history.length === 0 ? (
          <div className="mt-6 rounded-xl border border-dashed p-6 text-sm text-muted-foreground">
            No Pro purchases yet.
          </div>
        ) : (
          <div className="mt-6 space-y-3">
            {history.map((entry) => (
              <div
                key={entry.id}
                className="flex flex-col gap-3 rounded-xl border bg-muted/20 p-4 md:flex-row md:items-center md:justify-between"
              >
                <div className="space-y-1">
                  <div className="font-medium">
                    {Number(entry.amountSol).toFixed(2)} SOL
                  </div>
                  <div className="text-sm text-muted-foreground">
                    Active from {formatDateTime(entry.startsAt)} until{" "}
                    {formatDateTime(entry.expiresAt)}
                  </div>
                </div>
                <div className="text-sm text-muted-foreground">
                  <Link
                    href={`https://solscan.io/tx/${entry.txSignature}`}
                    target="_blank"
                    rel="noreferrer"
                    className="font-mono text-foreground hover:underline"
                  >
                    {formatSignature(entry.txSignature)}
                  </Link>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
