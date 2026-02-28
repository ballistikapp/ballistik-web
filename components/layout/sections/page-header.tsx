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
        "flex justify-between items-center gap-2 -m-6 px-6 py-14 border-b",
        className
      )}
    >
      <h1 className="text-4xl">{title}</h1>
      {rightContent ?? actions}
    </div>
  );
}
