"use client";

import Image from "next/image";
import { ChevronsUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandGroup,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  FUNNEL_PLATFORM_OPTIONS,
  type FunnelPlatformOptionId,
} from "@/components/launch/platform-availability";

type PlatformSelectorProps = {
  value: FunnelPlatformOptionId;
  onValueChange: (platform: FunnelPlatformOptionId) => void;
};

export function PlatformSelector({
  value,
  onValueChange,
}: PlatformSelectorProps) {
  const selected =
    FUNNEL_PLATFORM_OPTIONS.find((option) => option.id === value) ??
    FUNNEL_PLATFORM_OPTIONS[0];

  return (
    <section
      id="platform"
      className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
    >
      <h2 className="text-xl font-normal md:text-2xl">Platform</h2>
      <Popover>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            role="combobox"
            className="w-full justify-between sm:w-72"
          >
            <span className="flex items-center gap-2.5">
              <Image
                src={selected.logoSrc}
                alt={selected.logoAlt}
                width={20}
                height={20}
                className="size-5"
              />
              <span>{selected.label}</span>
            </span>
            <ChevronsUpDown className="size-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          className="w-(--radix-popover-trigger-width) p-0"
          align="start"
        >
          <Command>
            <CommandList>
              <CommandGroup>
                {FUNNEL_PLATFORM_OPTIONS.map((option) => (
                  <CommandItem
                    key={option.id}
                    value={option.id}
                    disabled={!option.available}
                    data-checked={option.id === value}
                    onSelect={() => {
                      if (option.available) {
                        onValueChange(option.id);
                      }
                    }}
                  >
                    <Image
                      src={option.logoSrc}
                      alt={option.logoAlt}
                      width={20}
                      height={20}
                      className={`size-5 ${option.available ? "" : "opacity-40"}`}
                    />
                    <span className={option.available ? "" : "opacity-60"}>
                      {option.label}
                    </span>
                    {"comingSoon" in option && option.comingSoon && (
                      <span className="ml-auto rounded-full border border-border bg-muted px-2 py-px text-[10px] font-medium text-muted-foreground">
                        Soon
                      </span>
                    )}
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </section>
  );
}
