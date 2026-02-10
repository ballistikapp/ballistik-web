import { Skeleton } from "@/components/ui/skeleton";

interface DashboardLoadingProps {
  compact?: boolean;
}

export function DashboardLoading({ compact }: DashboardLoadingProps) {
  return (
    <div className="flex flex-col gap-6">
      {!compact && (
        <Skeleton className="h-10 w-64 mb-2" />
      )}
      <Skeleton className="h-14 w-full rounded-xl" />
      <div className="grid grid-cols-1 gap-4 @xl/main:grid-cols-2 @5xl/main:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-32 rounded-xl" />
        ))}
      </div>
      <Skeleton className="h-[380px] w-full rounded-xl" />
      <Skeleton className="h-[400px] w-full rounded-xl" />
    </div>
  );
}
