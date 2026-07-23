import { Suspense } from "react";
import { OpsCreateMarketerForm } from "@/components/ops/ops-create-marketer-form";
import { Skeleton } from "@/components/ui/skeleton";

export default function OpsCreateMarketerPage() {
  return (
    <Suspense fallback={<Skeleton className="h-64 w-full max-w-xl" />}>
      <OpsCreateMarketerForm />
    </Suspense>
  );
}
