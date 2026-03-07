"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type PageSectionProps = {
  children: ReactNode;
  className?: string;
};

export function PageSection({ children, className }: PageSectionProps) {
  return <div className={cn("space-y-12", className)}>{children}</div>;
}
