import { Skeleton } from "@/components/ui/skeleton";

/**
 * Mirrors dashboard-client vertical rhythm (header → stats grid → ops → chart → holdings → tx).
 * Flat layout: no borders, rings, or card shells — only Skeleton + minimal flex/grid for alignment.
 */
export function DashboardPageSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-6 px-1 py-2 @xl/main:flex-nowrap">
        <div className="flex min-w-0 flex-1 items-center gap-3 @xl/main:flex-initial">
          <Skeleton className="size-11 shrink-0 rounded-lg" />
          <div className="flex min-w-0 flex-col gap-2">
            <Skeleton className="h-6 w-48 max-w-[min(100%,12rem)]" />
            <Skeleton className="h-3.5 w-28 max-w-full" />
          </div>
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-3">
          <Skeleton className="hidden h-4 w-28 sm:block" />
          <Skeleton className="size-8 rounded-md" />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 @xl/main:grid-cols-2 @5xl/main:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="min-h-[184px] rounded-xl" />
        ))}
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Skeleton className="h-4 w-64 max-w-full" />
        <div className="flex flex-wrap gap-1.5 sm:justify-end">
          <Skeleton className="h-8 w-24 rounded-md" />
          <Skeleton className="h-8 w-28 rounded-md" />
        </div>
      </div>

      <div className="flex flex-col gap-4">
        <div className="space-y-2">
          <Skeleton className="h-7 w-40" />
          <Skeleton className="h-4 w-72 max-w-full" />
        </div>
        <Skeleton className="h-[380px] w-full rounded-xl" />
      </div>

      <div className="flex flex-col gap-4">
        <Skeleton className="h-7 w-56" />
        <div className="grid grid-cols-2 gap-3 @xl/main:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-16 rounded-lg" />
          ))}
        </div>
        <Skeleton className="h-2.5 w-full rounded-full" />
        <Skeleton className="min-h-96 w-full rounded-xl" />
      </div>

      <div className="flex flex-col gap-4">
        <div className="space-y-1">
          <Skeleton className="h-7 w-52" />
          <Skeleton className="h-4 w-64 max-w-full" />
        </div>
        <div className="flex flex-col gap-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 px-1 py-1">
              <Skeleton className="size-8 shrink-0 rounded-full" />
              <div className="flex min-w-0 flex-1 flex-col gap-2">
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-3 w-36 max-w-full" />
              </div>
              <Skeleton className="h-4 w-16 shrink-0" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function DashboardLoading() {
  return <DashboardPageSkeleton />;
}
