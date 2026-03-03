"use client";

import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

type PageSectionDividerProps = {
  className?: string;
};

export function PageSectionDivider({ className }: PageSectionDividerProps) {
  return (
    <div className={cn("-mx-6 my-18", className)}>
      <Separator />
    </div>
  );
}
