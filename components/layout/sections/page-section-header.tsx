"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type PageSectionHeaderProps = {
  title: string;
  meta?: ReactNode;
  className?: string;
};

export function PageSectionHeader({
  title,
  meta,
  className,
}: PageSectionHeaderProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-start justify-between gap-2 md:flex-row md:items-baseline md:gap-4",
        className
      )}
    >
      <h2 className="text-xl font-normal md:text-2xl">{title}</h2>
      {meta}
    </div>
  );
}
