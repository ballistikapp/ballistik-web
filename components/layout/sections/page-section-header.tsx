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
    <div className={cn("flex items-baseline justify-between", className)}>
      <h2 className="text-2xl font-normal">{title}</h2>
      {meta}
    </div>
  );
}
