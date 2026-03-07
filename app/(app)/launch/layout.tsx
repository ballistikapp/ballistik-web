import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Launch",
};

export default function LaunchLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return children;
}
