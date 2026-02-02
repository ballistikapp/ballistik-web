import { Skeleton } from "@/components/ui/skeleton";

export function DashboardLoading() {
  return (
    <div className="flex flex-col gap-12">
      <div className="flex justify-between items-start gap-6 -m-6 px-6 py-6 border-b">
        <div className="flex flex-col gap-2 flex-1">
          <div className="flex flex-col gap-1">
            <Skeleton className="h-10 w-64" />
            <Skeleton className="h-7 w-32 mt-2" />
          </div>
          <Skeleton className="h-4 w-full max-w-2xl mt-2" />
          <Skeleton className="h-4 w-3/4 max-w-2xl mt-1" />
          <div className="flex flex-wrap gap-2 mt-2">
            <Skeleton className="h-7 w-20 rounded-full" />
            <Skeleton className="h-7 w-24 rounded-full" />
            <Skeleton className="h-7 w-20 rounded-full" />
          </div>
        </div>
        <Skeleton className="size-40 rounded-lg shrink-0" />
      </div>
      <div className="flex flex-col gap-6">
        <Skeleton className="h-64 w-full" />
        <Skeleton className="h-96 w-full" />
        <Skeleton className="h-96 w-full" />
      </div>
    </div>
  );
}
