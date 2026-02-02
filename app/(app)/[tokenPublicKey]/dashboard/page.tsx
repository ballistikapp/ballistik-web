import { Suspense } from "react";
import { DashboardLoading } from "./dashboard-loading";
import { DashboardClient } from "./dashboard-client";

export const dynamic = "force-dynamic";

export default function Page() {
  return (
    <Suspense fallback={<DashboardLoading />}>
      <DashboardClient />
    </Suspense>
  );
}
