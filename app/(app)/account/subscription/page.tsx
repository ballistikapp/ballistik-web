"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { format } from "date-fns";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc/client";
import {
  PageHeader,
  PageSection,
  PageSectionDivider,
  PageSectionHeader,
} from "@/components/layout/sections";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

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
  const [confirmOpen, setConfirmOpen] = useState(false);

  const overviewQuery = trpc.billing.getSubscriptionOverview.useQuery({});
  const historyQuery = trpc.billing.getHistory.useQuery({ limit: 20 });
  const refreshSessionMutation = trpc.auth.refreshSession.useMutation();
  const purchaseMutation = trpc.billing.purchaseWeeklyPro.useMutation();

  const overview = overviewQuery.data;
  const history = historyQuery.data ?? [];
  const isBusy = purchaseMutation.isPending || refreshSessionMutation.isPending;

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
          error instanceof Error ? error.message : "Failed to refresh session"
        );
      });
  }, [
    overview?.requiresTokenRefresh,
    refreshSessionMutation,
    utils.auth.me,
    utils.billing.getSubscriptionOverview,
  ]);

  const ctaLabel = useMemo(() => {
    if (overview?.status === "ACTIVE") {
      return "Extend Pro";
    }
    if (overview?.status === "EXPIRED") {
      return "Renew Pro";
    }
    return "Subscribe to Pro";
  }, [overview?.status]);

  const handlePurchase = async () => {
    try {
      const result = await purchaseMutation.mutateAsync({});
      setConfirmOpen(false);
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
        <Skeleton className="h-40 w-full rounded-xl" />
        <Skeleton className="h-64 w-full rounded-xl" />
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
    <>
      <div className="flex flex-col gap-6">
        <PageHeader
          title="Subscription"
          rightContent={
            <div className="w-full text-left md:text-right">
              <div className="flex flex-wrap items-center gap-2 md:justify-end">
                <Badge
                  variant={overview.plan === "PRO" ? "default" : "secondary"}
                  className="h-8 rounded-full px-4 text-sm font-semibold"
                >
                  {overview.plan === "PRO" ? "Pro" : "Free"}
                </Badge>
              </div>
              <p className="mt-3 text-xs uppercase tracking-tighter font-mono font-semibold text-muted-foreground md:mt-4">
                WEEKLY PRICE
              </p>
              <p className="font-mono leading-none">
                <span className="text-2xl md:text-4xl">{overview.priceSol.toFixed(2)}</span>{" "}
                <span className="text-base text-muted-foreground">SOL</span>
              </p>
            </div>
          }
        />

        <PageSection className="pt-6 md:pt-8">
          <div className="grid gap-12 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:items-start">
            <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-linear-to-b from-neutral-900/90 to-black p-5 text-neutral-50 shadow-[0_0_0_1px_rgba(255,255,255,0.02)] sm:p-6 md:p-8">
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.14),transparent_36%),radial-gradient(circle_at_bottom_right,rgba(255,255,255,0.08),transparent_32%)]" />
              <div className="absolute inset-0 bg-[radial-gradient(rgba(255,255,255,0.18)_1px,transparent_1px)] bg-size-[18px_18px] opacity-30 mask-[radial-gradient(circle_at_center,black,transparent_75%)]" />
              <div className="relative space-y-6 md:space-y-8">
                <div className="space-y-3">
                  <p className="text-[11px] uppercase tracking-[0.22em] text-neutral-500">
                    Weekly Pro
                  </p>
                  <PageSectionHeader
                    title="Pro Features"
                    className="items-start"
                    meta={
                      <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] uppercase tracking-[0.12em] text-neutral-300">
                        Account-wide access
                      </span>
                    }
                  />
                  <p className="max-w-md text-sm text-neutral-400">
                    Faster tooling, live monitoring, and cleaner execution with
                    fewer platform charges on supported flows.
                  </p>
                </div>

                <div className="grid gap-3">
                  {[
                    {
                      label: "No fees.",
                      description:
                        "Platform fees are removed on supported launch and volume-bot flows.",
                      accent: true,
                    },
                    {
                      label: "Live monitoring.",
                      description: "Track dashboard activity in real time.",
                      accent: false,
                    },
                    {
                      label: "Faster execution.",
                      description:
                        "Use gRPC-backed confirmation paths where supported.",
                      accent: false,
                    },
                  ].map((feature) => (
                    <div
                      key={feature.label}
                      className="flex items-start gap-3 rounded-2xl border border-white/8 bg-white/3 px-4 py-3"
                    >
                      <span
                        className={`mt-1.5 size-2 rounded-full ${
                          feature.accent ? "bg-primary" : "bg-neutral-200"
                        }`}
                      />
                      <span className="text-sm text-neutral-200">
                        <strong
                          className={`font-semibold uppercase tracking-[0.08em] ${
                            feature.accent ? "text-primary" : "text-neutral-50"
                          }`}
                        >
                          {feature.label}
                        </strong>
                        <span className="mt-1 block">{feature.description}</span>
                      </span>
                    </div>
                  ))}
                </div>

                <p className="text-sm text-neutral-500">
                  Each purchase extends Pro by 7 days. There is no auto-renewal
                  in this version.
                </p>
              </div>
            </div>

            <div className="space-y-8">
              <div className="space-y-3">
                <h2 className="text-2xl font-normal">Weekly Pro access</h2>
                <p className="max-w-2xl text-sm text-muted-foreground">
                  Pro unlocks live monitoring, faster gRPC-backed tooling, and
                  removes platform fees on supported flows.
                </p>
              </div>

              <div className="grid gap-5 sm:grid-cols-2 sm:gap-8">
                <div className="space-y-2">
                  <p className="text-xs uppercase tracking-tighter font-mono font-semibold text-muted-foreground">
                    PLAN
                  </p>
                  <p className="text-xl">
                    {overview.plan === "PRO" ? "Pro" : "Free"}
                  </p>
                </div>
                <div className="space-y-2">
                  <p className="text-xs uppercase tracking-tighter font-mono font-semibold text-muted-foreground">
                    EXPIRES
                  </p>
                  <p className="text-xl">
                    {overview.proExpiresAt
                      ? formatDateTime(overview.proExpiresAt)
                      : "Not active"}
                  </p>
                </div>
              </div>

              <div className="space-y-2 text-sm text-muted-foreground">
                <p>
                  Pro removes platform fees only. Network, protocol, rent, and
                  Jito costs still apply when relevant.
                </p>
                <p>
                  There is no auto-renewal. When your period ends, you can renew
                  manually from this page.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <Button
                  onClick={() => setConfirmOpen(true)}
                  disabled={isBusy}
                  size="lg"
                >
                  {ctaLabel}
                </Button>
                <Button variant="outline" size="lg" asChild>
                  <Link href="/account">View account</Link>
                </Button>
              </div>
            </div>
          </div>

          <PageSectionDivider className="my-14 md:my-24" />

          <div className="space-y-10 pb-8">
            <PageSectionHeader
              title="Billing history"
              meta={
                <p className="text-sm text-muted-foreground">
                  Recent weekly Pro purchases charged from your main wallet.
                </p>
              }
            />

            {historyQuery.isLoading ? (
              <div className="mt-8 grid gap-5">
                <Skeleton className="h-20 w-full rounded-none" />
                <Skeleton className="h-20 w-full rounded-none" />
              </div>
            ) : history.length === 0 ? (
              <div className="border-t pt-10 pb-6 text-sm text-muted-foreground">
                No Pro purchases yet.
              </div>
            ) : (
              <div className="border-t pt-4">
                {history.map((entry) => (
                  <div
                    key={entry.id}
                    className="flex flex-col gap-4 border-b py-6 md:flex-row md:items-center md:justify-between"
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
          </div>
        </PageSection>
      </div>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{ctaLabel}</DialogTitle>
            <DialogDescription>
              This will charge {overview.priceSol.toFixed(2)} SOL from your main
              wallet and activate Pro for 7 days.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 text-sm text-muted-foreground">
            <p>
              Pro removes platform fees only. Network, protocol, rent, and Jito
              costs still apply when relevant.
            </p>
            {overview.proExpiresAt ? (
              <p>
                Your current access{" "}
                {overview.status === "ACTIVE" ? "ends" : "ended"} on{" "}
                {formatDateTime(overview.proExpiresAt)}.
              </p>
            ) : null}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setConfirmOpen(false)}
              disabled={isBusy}
            >
              Cancel
            </Button>
            <Button onClick={handlePurchase} disabled={isBusy}>
              {isBusy ? (
                <>
                  <Spinner className="mr-2 size-4" />
                  Processing...
                </>
              ) : (
                `Confirm and pay ${overview.priceSol.toFixed(2)} SOL`
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
