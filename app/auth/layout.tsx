import { Suspense } from "react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { getServerUser } from "@/lib/utils/auth";
import { getSafeRedirectPath } from "@/lib/utils/auth-redirect";

export const metadata: Metadata = {
  title: "Auth",
};

export default async function AuthLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const user = await getServerUser();
  if (user) {
    const requestHeaders = await headers();
    const invokeQuery = requestHeaders.get("x-invoke-query");
    const redirectTarget = getSafeRedirectPath(
      new URLSearchParams(invokeQuery ?? "").get("redirect")
    );
    redirect(redirectTarget);
  }

  return <Suspense fallback={<AuthLoadingFallback />}>{children}</Suspense>;
}

function AuthLoadingFallback() {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="animate-pulse text-muted-foreground">Loading...</div>
    </div>
  );
}
