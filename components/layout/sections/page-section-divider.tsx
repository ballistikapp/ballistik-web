"use client";

import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

type PageSectionDividerProps = {
  className?: string;
};

export function PageSectionDivider({ className }: PageSectionDividerProps) {
  return (
    <div className={cn("-mx-4 my-10 md:-mx-6 md:my-14 xl:-mx-8", className)}>
      <Separator />
    </div>
  );
}
