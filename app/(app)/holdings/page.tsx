"use client";

import { useQueryState } from "nuqs";
import { tokenQueryParser } from "@/lib/utils/token-query";
import { trpc } from "@/lib/trpc/client";
import { TokenNotFound } from "@/components/placeholders/token-not-found";
import { DashboardLoading } from "../dashboard/dashboard-loading";

export default function Page() {
  const [tokenPublicKey] = useQueryState("token", tokenQueryParser);

  const {
    data: tokenData,
    isLoading,
    error,
    refetch,
  } = trpc.token.getByPublicKey.useQuery(
    { publicKey: tokenPublicKey || "" },
    { enabled: !!tokenPublicKey }
  );

  if (isLoading) {
    return <DashboardLoading />;
  }

  if (!tokenData) {
    return <TokenNotFound error={error} onRetry={() => refetch()} />;
  }

  return (
    <div className="flex flex-col gap-12">
      <div className="flex justify-between items-center gap-2 -m-6 px-6 py-10 border-b">
        <h1 className="text-4xl">Holdings</h1>
        <p className=" leading-tight font-light text-right text-muted-foreground">
          View your token holdings.
          <br />
          View your token holdings on pump.fun.
        </p>
      </div>

      <div>holdings</div>
    </div>
  );
}
