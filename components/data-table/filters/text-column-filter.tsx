"use client";

import * as React from "react";
import { type Column } from "@tanstack/react-table";
import { IconCheck, IconX } from "@tabler/icons-react";

import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";

interface TextColumnFilterProps<TData, TValue> {
  column: Column<TData, TValue>;
}

export function TextColumnFilter<TData, TValue>({
  column,
}: TextColumnFilterProps<TData, TValue>) {
  const facetedValues = column.getFacetedUniqueValues();
  const selectedValues = new Set(
    (column.getFilterValue() as string[] | undefined) ?? []
  );

  const options = React.useMemo(() => {
    const values: { value: string; count: number }[] = [];
    facetedValues.forEach((count, value) => {
      if (value !== null && value !== undefined) {
        values.push({ value: String(value), count });
      }
    });
    return values.sort((a, b) => a.value.localeCompare(b.value));
  }, [facetedValues]);

  const handleSelect = (value: string) => {
    const newSelectedValues = new Set(selectedValues);
    if (newSelectedValues.has(value)) {
      newSelectedValues.delete(value);
    } else {
      newSelectedValues.add(value);
    }
    const filterValues = Array.from(newSelectedValues);
    column.setFilterValue(filterValues.length ? filterValues : undefined);
  };

  const handleClear = () => {
    column.setFilterValue(undefined);
  };

  return (
    <Command>
      <CommandInput placeholder="Search..." />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>
        <CommandGroup>
          {options.map((option) => {
            const isSelected = selectedValues.has(option.value);
            return (
              <CommandItem
                key={option.value}
                onSelect={() => handleSelect(option.value)}
                data-checked={isSelected}
              >
                <div
                  className={cn(
                    "flex size-4 items-center justify-center rounded-sm border border-primary",
                    isSelected
                      ? "bg-primary text-primary-foreground"
                      : "opacity-50 [&_svg]:invisible"
                  )}
                >
                  <IconCheck className="size-3" />
                </div>
                <span className="flex-1 truncate">{option.value}</span>
                <Badge
                  variant="secondary"
                  className="ml-auto font-mono text-xs"
                >
                  {option.count}
                </Badge>
              </CommandItem>
            );
          })}
        </CommandGroup>
        {selectedValues.size > 0 && (
          <>
            <CommandSeparator />
            <CommandGroup>
              <CommandItem
                onSelect={handleClear}
                className="justify-center text-center"
              >
                <IconX className="size-4" />
                Clear filters
              </CommandItem>
            </CommandGroup>
          </>
        )}
      </CommandList>
    </Command>
  );
}
