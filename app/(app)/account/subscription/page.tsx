"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { format } from "date-fns";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc/client";
import {
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

type PurchaseTarget = "DEVELOPER" | "PRO" | null;

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

function planLabel(plan: string) {
  if (plan === "PRO") return "Pro";
  if (plan === "DEVELOPER") return "Developer";
  return "Free";
}

const DEVELOPER_FEATURES = [
  {
    label: "CREATOR REWARDS ELIGIBILITY",
    description:
      "Collect creator rewards with a single click as your token grows.",
    accent: true,
  },
  {
    label: "25% off platform fees.",
    description:
      "Reduced platform fees on supported launch and volume-bot flows.",
    accent: false,
  },
];

const PRO_FEATURES = [
  {
    label: "No platform fees.",
    description:
      "Platform fees are fully removed on launch and volume-bot flows.",
    accent: true,
  },
  {
    label: "Live monitoring.",
    description: "Track dashboard activity in real time via gRPC.",
    accent: false,
  },
  {
    label: "Faster execution.",
    description: "Use gRPC-backed confirmation paths where supported.",
    accent: false,
  },
];

export default function AccountSubscriptionPage() {
  const utils = trpc.useUtils();
  const refreshTriggeredRef = useRef(false);
  const [confirmTarget, setConfirmTarget] = useState<PurchaseTarget>(null);

  const overviewQuery = trpc.billing.getSubscriptionOverview.useQuery({});
  const historyQuery = trpc.billing.getHistory.useQuery({ limit: 20 });
  const refreshSessionMutation = trpc.auth.refreshSession.useMutation();
  const purchaseMutation = trpc.billing.purchaseSubscription.useMutation();

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

  const confirmChargeLabel = useMemo(() => {
    if (!overview || !confirmTarget) return "";
    if (
      confirmTarget === "PRO" &&
      overview.plan === "DEVELOPER" &&
      overview.upgradeChargeSol != null
    ) {
      return `${overview.upgradeChargeSol.toFixed(2)} SOL`;
    }
    if (confirmTarget === "DEVELOPER")
      return `${overview.developerPriceSol.toFixed(2)} SOL`;
    return `${overview.proPriceSol.toFixed(2)} SOL`;
  }, [overview, confirmTarget]);

  const confirmDescription = useMemo(() => {
    if (!overview || !confirmTarget) return "";
    const planName = planLabel(confirmTarget);
    if (
      confirmTarget === "PRO" &&
      overview.plan === "DEVELOPER" &&
      overview.upgradeCredit != null &&
      overview.upgradeCredit > 0
    ) {
      return `Upgrade to ${planName} for ${confirmChargeLabel}. A credit of ${overview.upgradeCredit.toFixed(2)} SOL has been applied for your remaining Developer days.`;
    }
    return `This will charge ${confirmChargeLabel} from your main wallet and activate ${planName} for 7 days.`;
  }, [overview, confirmTarget, confirmChargeLabel]);

  const handlePurchase = async () => {
    if (!confirmTarget) return;
    try {
      const result = await purchaseMutation.mutateAsync({
        plan: confirmTarget,
      });
      setConfirmTarget(null);
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
      const planName = planLabel(confirmTarget);
      toast.success(
        refreshFailed
          ? `Payment confirmed. Refresh your session to see ${planName} access until ${formatDateTime(result.paidPlanExpiresAt)}.`
          : `${planName} is active until ${formatDateTime(result.paidPlanExpiresAt)}`
      );
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to complete purchase"
      );
    }
  };

  if (overviewQuery.isLoading) {
    return (
      <div className="flex flex-col gap-6">
        <Skeleton className="h-40 w-full rounded-xl" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    );
  }

  if (!overview) {
    return (
      <div className="flex flex-col gap-4 py-10">
        <p className="text-sm text-muted-foreground">
          Subscription details are unavailable right now.
        </p>
      </div>
    );
  }

  const isDeveloper = overview.plan === "DEVELOPER";
  const isPro = overview.plan === "PRO";
  const isPaid = isDeveloper || isPro;

  return (
    <>
      <div className="flex flex-col gap-6">
        <PageSection className="pt-6 md:pt-8">
          <div className="mb-8 flex flex-wrap items-center gap-3">
            <Badge
              variant={isPaid ? "default" : "secondary"}
              className="h-8 rounded-full px-4 text-sm font-semibold"
            >
              {planLabel(overview.plan)}
            </Badge>
            {isPaid && overview.paidPlanExpiresAt && (
              <p className="text-xs text-muted-foreground">
                Active until {formatDateTime(overview.paidPlanExpiresAt)}
              </p>
            )}
          </div>
          <div className="grid gap-8 lg:grid-cols-2 lg:items-start">
            {/* Developer Tier */}
            <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-linear-to-b from-neutral-900/90 to-black p-5 text-neutral-50 shadow-[0_0_0_1px_rgba(255,255,255,0.02)] sm:p-6 md:p-8">
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.14),transparent_36%),radial-gradient(circle_at_bottom_right,rgba(255,255,255,0.08),transparent_32%)]" />
              <div className="absolute inset-0 bg-[radial-gradient(rgba(255,255,255,0.18)_1px,transparent_1px)] bg-size-[18px_18px] opacity-30 mask-[radial-gradient(circle_at_center,black,transparent_75%)]" />
              <div className="relative space-y-6 md:space-y-8">
                <div className="space-y-3">
                  <p className="text-[11px] uppercase tracking-[0.22em] text-neutral-500">
                    Weekly Developer
                  </p>
                  <PageSectionHeader
                    title="Developer"
                    className="items-start"
                    meta={
                      <span className="font-mono text-2xl md:text-3xl text-neutral-100">
                        {overview.developerPriceSol.toFixed(2)}{" "}
                        <span className="text-base text-neutral-400">
                          SOL / week
                        </span>
                      </span>
                    }
                  />
                </div>

                <div className="grid gap-3">
                  {DEVELOPER_FEATURES.map((feature) => (
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
                        <span className="mt-1 block">
                          {feature.description}
                        </span>
                      </span>
                    </div>
                  ))}
                </div>

                <div>
                  {isDeveloper ? (
                    <Button
                      onClick={() => setConfirmTarget("DEVELOPER")}
                      disabled={isBusy}
                      className="w-full"
                      size="lg"
                    >
                      Extend Developer
                    </Button>
                  ) : isPro ? (
                    <Button
                      variant="outline"
                      disabled
                      className="w-full"
                      size="lg"
                    >
                      Pro is active
                    </Button>
                  ) : (
                    <Button
                      onClick={() => setConfirmTarget("DEVELOPER")}
                      disabled={isBusy}
                      className="w-full"
                      size="lg"
                    >
                      Subscribe to Developer
                    </Button>
                  )}
                </div>
              </div>
            </div>

            {/* Pro Tier */}
            <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-linear-to-b from-neutral-900/90 to-black p-5 text-neutral-50 shadow-[0_0_0_1px_rgba(255,255,255,0.02)] sm:p-6 md:p-8">
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.14),transparent_36%),radial-gradient(circle_at_bottom_right,rgba(255,255,255,0.08),transparent_32%)]" />
              <div className="absolute inset-0 bg-[radial-gradient(rgba(255,255,255,0.18)_1px,transparent_1px)] bg-size-[18px_18px] opacity-30 mask-[radial-gradient(circle_at_center,black,transparent_75%)]" />
              <div className="relative space-y-6 md:space-y-8">
                <div className="space-y-3">
                  <p className="text-[11px] uppercase tracking-[0.22em] text-neutral-500">
                    Weekly Pro
                  </p>
                  <PageSectionHeader
                    title="Pro"
                    className="items-start"
                    meta={
                      <span className="font-mono text-2xl md:text-3xl text-neutral-100">
                        {isDeveloper && overview.upgradeChargeSol != null ? (
                          <>
                            <span className="line-through text-neutral-500 mr-2">
                              {overview.proPriceSol.toFixed(2)}
                            </span>
                            {overview.upgradeChargeSol.toFixed(2)}
                          </>
                        ) : (
                          overview.proPriceSol.toFixed(2)
                        )}{" "}
                        <span className="text-base text-neutral-400">
                          SOL / week
                        </span>
                      </span>
                    }
                  />
                  {isDeveloper &&
                    overview.upgradeCredit != null &&
                    overview.upgradeCredit > 0 && (
                      <p className="text-xs text-emerald-400">
                        Includes {overview.upgradeCredit.toFixed(2)} SOL credit
                        for remaining Developer days
                      </p>
                    )}
                </div>

                <div className="grid gap-3">
                  {PRO_FEATURES.map((feature) => (
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
                        <span className="mt-1 block">
                          {feature.description}
                        </span>
                      </span>
                    </div>
                  ))}
                </div>

                <p className="text-sm text-neutral-300">
                  + Everything Developer plan offers
                </p>

                <div>
                  {isPro ? (
                    <Button
                      onClick={() => setConfirmTarget("PRO")}
                      disabled={isBusy}
                      className="w-full"
                      size="lg"
                    >
                      Extend Pro
                    </Button>
                  ) : (
                    <Button
                      onClick={() => setConfirmTarget("PRO")}
                      disabled={isBusy}
                      className="w-full"
                      size="lg"
                    >
                      {isDeveloper ? "Upgrade to Pro" : "Subscribe to Pro"}
                    </Button>
                  )}
                </div>
              </div>
            </div>
          </div>

          <div className="mt-8 space-y-2 text-sm text-muted-foreground">
            <p>
              Paid plans remove or reduce platform fees only. Network, protocol,
              rent, and Jito costs still apply when relevant.
            </p>
            <p>
              There is no auto-renewal. When your period ends, you can renew
              manually from this page.
            </p>
          </div>

          <PageSectionDivider className="mx-0 my-14 md:mx-0 md:my-24 lg:-ml-6 xl:mx-0 xl:-ml-6" />

          <div className="space-y-10 pb-8">
            <PageSectionHeader
              title="Billing history"
              meta={
                <p className="text-sm text-muted-foreground">
                  Recent subscription purchases charged from your main wallet.
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
                No purchases yet.
              </div>
            ) : (
              <div className="border-t pt-4">
                {history.map((entry) => (
                  <div
                    key={entry.id}
                    className="flex flex-col gap-4 border-b py-6 md:flex-row md:items-center md:justify-between"
                  >
                    <div className="space-y-1">
                      <div className="flex items-center gap-2 font-medium">
                        {Number(entry.amountSol).toFixed(2)} SOL
                        <Badge variant="outline" className="text-xs">
                          {planLabel(entry.plan)}
                        </Badge>
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

      <Dialog
        open={confirmTarget !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmTarget(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {confirmTarget === "PRO" && isDeveloper
                ? "Upgrade to Pro"
                : confirmTarget
                  ? `${overview.plan === confirmTarget ? "Extend" : "Subscribe to"} ${planLabel(confirmTarget)}`
                  : ""}
            </DialogTitle>
            <DialogDescription>{confirmDescription}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 text-sm text-muted-foreground">
            <p>
              {confirmTarget === "PRO"
                ? "Pro removes platform fees entirely and unlocks live monitoring and gRPC-backed tooling."
                : "Developer provides a 25% platform fee discount and lets you choose a creator-reward-eligible dev wallet at launch."}
            </p>
            <p>
              Network, protocol, rent, and Jito costs still apply when relevant.
            </p>
            {overview.paidPlanExpiresAt ? (
              <p>
                Your current access{" "}
                {overview.status === "ACTIVE" ? "ends" : "ended"} on{" "}
                {formatDateTime(overview.paidPlanExpiresAt)}.
              </p>
            ) : null}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setConfirmTarget(null)}
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
                `Confirm and pay ${confirmChargeLabel}`
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
