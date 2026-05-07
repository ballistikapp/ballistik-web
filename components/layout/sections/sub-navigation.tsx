"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

export type SubNavigationItem = {
  href: string;
  content: ReactNode;
  activeMatch?: (pathname: string, href: string) => boolean;
};

type SubNavigationProps = {
  items: SubNavigationItem[];
  className?: string;
};

function defaultActiveMatch(pathname: string, href: string) {
  return pathname === href;
}

export function SubNavigation({ items, className }: SubNavigationProps) {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Section navigation"
      className={cn("flex w-full flex-col gap-2", className)}
    >
      {items.map((item) => {
        const isActive = (item.activeMatch ?? defaultActiveMatch)(
          pathname,
          item.href
        );

        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "flex w-full items-center rounded-md px-2 py-2 text-base font-normal text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              isActive && "text-foreground"
            )}
          >
            {item.content}
          </Link>
        );
      })}
    </nav>
  );
}
