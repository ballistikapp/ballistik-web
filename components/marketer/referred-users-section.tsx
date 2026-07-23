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

export function ReferredUsersSection() {
  const { data, isLoading, isError, error } =
    trpc.marketer.listReferredUsers.useQuery(undefined, { retry: false });

  return (
    <PageSection>
      <PageSectionHeader title="Referred Users" />
      {isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-3/4" />
        </div>
      ) : isError ? (
        <p className="text-destructive text-sm">
          {error.message || "Failed to load referred Users"}
        </p>
      ) : !data?.length ? (
        <p className="text-muted-foreground text-sm">
          Users attributed to your referral code will appear here.
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>User</TableHead>
              <TableHead>Main Wallet</TableHead>
              <TableHead>Joined</TableHead>
              <TableHead>Earned</TableHead>
              <TableHead>Last payout</TableHead>
              <TableHead>Payouts</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.map((row) => (
              <TableRow key={row.referralId}>
                <TableCell className="font-medium">{row.name}</TableCell>
                <TableCell className="font-mono text-xs">
                  <span title={row.mainWalletPublicKey}>
                    {truncateAddress(row.mainWalletPublicKey)}
                  </span>
                </TableCell>
                <TableCell className="text-muted-foreground text-sm">
                  {formatWhen(row.joinedAt)}
                </TableCell>
                <TableCell className="font-medium">
                  {formatSol(lamportsToSol(row.totalEarnedLamports))} SOL
                </TableCell>
                <TableCell className="text-muted-foreground text-sm">
                  {row.lastPayoutAt ? formatWhen(row.lastPayoutAt) : "—"}
                </TableCell>
                <TableCell className="text-muted-foreground text-sm">
                  {row.payoutCount}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </PageSection>
  );
}
