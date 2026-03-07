import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Holdings",
};

export default function HoldingsLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return children;
}
