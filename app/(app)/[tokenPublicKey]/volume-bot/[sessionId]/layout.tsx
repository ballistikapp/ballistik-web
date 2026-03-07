import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Volume Bot Session",
};

export default function VolumeBotSessionLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return children;
}
