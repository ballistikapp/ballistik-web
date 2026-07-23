import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "My Tokens",
};

export default function MyTokensLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return children;
}
