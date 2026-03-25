"use client";

import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

type PageSectionDividerProps = {
  className?: string;
};

export function PageSectionDivider({ className }: PageSectionDividerProps) {
  return (
    <div className={cn("my-10 md:my-14", className)}>
      <Separator />
    </div>
  );
}
