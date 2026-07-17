"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const OPS_NAV = [
  { title: "Overview", href: "/ops" },
  { title: "Users", href: "/ops/users" },
  { title: "Wallets", href: "/ops/wallets" },
  { title: "Tokens", href: "/ops/tokens" },
  { title: "Launches", href: "/ops/launches" },
] as const;

function isActivePath(pathname: string, href: string) {
  if (href === "/ops") {
    return pathname === "/ops";
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function OpsSidebar() {
  const pathname = usePathname();

  return (
    <nav aria-label="Ops Console" className="flex flex-col gap-1">
      {OPS_NAV.map((item) => {
        const active = isActivePath(pathname, item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "rounded-md px-3 py-2 text-sm transition-colors",
              active
                ? "bg-muted text-foreground font-medium"
                : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
            )}
          >
            {item.title}
          </Link>
        );
      })}
    </nav>
  );
}
