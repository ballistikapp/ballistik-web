import type { Metadata } from "next";
import { AccountNav } from "./account-nav";

export const metadata: Metadata = {
  title: "Account",
};

export default function AccountLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <div className="flex flex-col gap-6">
      <AccountNav />
      {children}
    </div>
  );
}
