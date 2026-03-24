"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const accountRoutes = [
  { href: "/account", label: "Profile" },
  { href: "/account/subscription", label: "Subscription" },
];

export function AccountNav() {
  const pathname = usePathname();

  return (
    <nav className="flex flex-wrap gap-2 border-b pb-4">
      {accountRoutes.map((route) => {
        const isActive =
          pathname === route.href ||
          (route.href !== "/account" && pathname.startsWith(`${route.href}/`));

        return (
          <Link
            key={route.href}
            href={route.href}
            className={cn(
              "rounded-full px-4 py-2 text-sm transition-colors",
              isActive
                ? "bg-foreground text-background"
                : "bg-muted text-muted-foreground hover:text-foreground"
            )}
          >
            {route.label}
          </Link>
        );
      })}
    </nav>
  );
}
