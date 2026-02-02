import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getServerUser } from "@/lib/utils/auth";

export default async function AuthLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const user = await getServerUser();
  if (user) {
    redirect("/");
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
