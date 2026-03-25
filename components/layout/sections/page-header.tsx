"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type PageHeaderProps = {
  title: string;
  rightContent?: ReactNode;
  actions?: ReactNode;
  className?: string;
};

export function PageHeader({
  title,
  rightContent,
  actions,
  className,
}: PageHeaderProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-start justify-between gap-4 border-b px-0 pb-8 pt-6 md:flex-row md:items-center md:gap-6 md:pb-10 md:pt-8",
        className
      )}
    >
      <h1 className="text-2xl leading-tight md:text-4xl">{title}</h1>
      {rightContent ?? actions}
    </div>
  );
}
