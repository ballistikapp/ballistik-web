"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type PageHeaderProps = {
  title: ReactNode;
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
        "-mx-4 flex flex-col items-start justify-between gap-4 border-b px-4 py-8 md:-mx-6 md:flex-row md:items-center md:gap-6 md:px-6 md:pb-12 md:pt-8 xl:-mx-8 xl:px-8",
        className
      )}
    >
      {typeof title === "string" ? (
        <h1 className="shrink-0 whitespace-nowrap text-2xl leading-tight md:text-4xl">{title}</h1>
      ) : (
        title
      )}
      {rightContent ?? actions}
    </div>
  );
}
