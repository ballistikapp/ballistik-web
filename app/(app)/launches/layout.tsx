import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Launches",
};

export default function LaunchesLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return children;
}
