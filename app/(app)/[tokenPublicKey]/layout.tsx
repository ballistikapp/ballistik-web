"use client";

import { useParams, redirect } from "next/navigation";
import { useEffect } from "react";
import { useTokenContext } from "@/contexts/token-context";
import { trpc } from "@/lib/trpc/client";
import { DashboardLoading } from "./dashboard/dashboard-loading";
import { TokenNotFound } from "@/components/placeholders/token-not-found";

export default function TokenLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const params = useParams();
  const tokenPublicKey = params?.tokenPublicKey as string;
  const { setSelectedTokenPublicKey } = useTokenContext();

  const {
    data: tokenData,
    isLoading,
    error,
    refetch,
  } = trpc.token.getByPublicKey.useQuery(
    { publicKey: tokenPublicKey || "" },
    { enabled: !!tokenPublicKey }
  );

  useEffect(() => {
    if (tokenPublicKey && tokenData) {
      setSelectedTokenPublicKey(tokenPublicKey);
    }
  }, [tokenPublicKey, tokenData, setSelectedTokenPublicKey]);

  if (!tokenPublicKey) {
    redirect("/launch");
  }

  if (isLoading) {
    return <DashboardLoading />;
  }

  if (!tokenData || error) {
    return <TokenNotFound error={error} onRetry={() => refetch()} />;
  }

  return <>{children}</>;
}
