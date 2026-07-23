import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Launch history",
};

export default function LaunchHistoryLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return children;
}
