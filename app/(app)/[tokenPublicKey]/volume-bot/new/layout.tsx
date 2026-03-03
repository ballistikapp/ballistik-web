import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "New Volume Bot Session",
};

export default function NewVolumeBotSessionLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return children;
}
