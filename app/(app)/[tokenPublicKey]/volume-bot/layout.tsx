import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Volume Bot",
};

export default function VolumeBotLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return children;
}
