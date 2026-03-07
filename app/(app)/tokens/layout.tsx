import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Tokens",
};

export default function TokensLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return children;
}
