"use client";

import {
  PageSection,
  PageSectionHeader,
} from "@/components/layout/sections";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatSol, truncateAddress } from "@/lib/utils/format";
import { trpc } from "@/lib/trpc/client";

function lamportsToSol(lamports: bigint | number): number {
  return Number(lamports) / 1_000_000_000;
}

function formatWhen(value: Date) {
  return new Date(value).toLocaleString();
}

function formatRate(rate: number) {
  return `${(rate * 100).toFixed(rate * 100 >= 10 || rate === 0 ? 0 : 1)}%`;
}

export function PayoutsSection() {
  const aggregatesQuery = trpc.marketer.getAggregates.useQuery(undefined, {
    retry: false,
  });
  const payoutsQuery = trpc.marketer.listPayouts.useQuery(undefined, {
    retry: false,
  });

  const isLoading = aggregatesQuery.isLoading || payoutsQuery.isLoading;
  const isError = aggregatesQuery.isError || payoutsQuery.isError;
  const errorMessage =
    aggregatesQuery.error?.message ||
    payoutsQuery.error?.message ||
    "Failed to load Referral Payouts";

  const aggregates = aggregatesQuery.data;
  const payouts = payoutsQuery.data;

  return (
    <PageSection>
      <PageSectionHeader title="Referral Payouts" />
      {isLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-3/4" />
        </div>
      ) : isError ? (
        <p className="text-destructive text-sm">{errorMessage}</p>
      ) : (
        <>
          <div className="text-muted-foreground mb-4 grid gap-2 text-sm sm:grid-cols-3">
            <div>
              <p className="text-foreground font-medium">
                {formatSol(
                  lamportsToSol(aggregates?.totalEarnedLamports ?? BigInt(0))
                )}{" "}
                SOL
              </p>
              <p>Total earned</p>
            </div>
            <div>
              <p className="text-foreground font-medium">
                {aggregates?.referralCount ?? 0}
              </p>
              <p>Referrals</p>
            </div>
            <div>
              <p className="text-foreground font-medium">
                {aggregates?.lastPayoutAt
                  ? formatWhen(aggregates.lastPayoutAt)
                  : "—"}
              </p>
              <p>Last payout</p>
            </div>
          </div>
          {!payouts?.length ? (
            <p className="text-muted-foreground text-sm">
              Payouts from referred Users&apos; platform fees will appear here.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Amount</TableHead>
                  <TableHead>User</TableHead>
                  <TableHead>Rate</TableHead>
                  <TableHead>When</TableHead>
                  <TableHead>Signature</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {payouts.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-medium">
                      {formatSol(lamportsToSol(row.marketerAmountLamports))} SOL
                    </TableCell>
                    <TableCell>
                      <div className="font-medium">{row.referredUser.name}</div>
                      <div
                        className="text-muted-foreground font-mono text-xs"
                        title={row.referredUser.mainWalletPublicKey}
                      >
                        {truncateAddress(row.referredUser.mainWalletPublicKey)}
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {formatRate(row.feeShareRate)}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {formatWhen(row.createdAt)}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      <span title={row.txSignature}>
                        {truncateAddress(row.txSignature)}
                      </span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </>
      )}
    </PageSection>
  );
}
