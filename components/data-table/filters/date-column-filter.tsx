"use client";

import * as React from "react";
import { type Column } from "@tanstack/react-table";
import { format, subDays, startOfMonth, endOfMonth, startOfDay, endOfDay } from "date-fns";
import { type DateRange } from "react-day-picker";
import { IconX } from "@tabler/icons-react";

import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import type { DateRangeFilter } from "../types";

interface DateColumnFilterProps<TData, TValue> {
  column: Column<TData, TValue>;
}

const presets = [
  {
    label: "Today",
    getValue: () => ({
      from: startOfDay(new Date()),
      to: endOfDay(new Date()),
    }),
  },
  {
    label: "Last 7 days",
    getValue: () => ({
      from: startOfDay(subDays(new Date(), 6)),
      to: endOfDay(new Date()),
    }),
  },
  {
    label: "Last 30 days",
    getValue: () => ({
      from: startOfDay(subDays(new Date(), 29)),
      to: endOfDay(new Date()),
    }),
  },
  {
    label: "This month",
    getValue: () => ({
      from: startOfMonth(new Date()),
      to: endOfMonth(new Date()),
    }),
  },
];

export function DateColumnFilter<TData, TValue>({
  column,
}: DateColumnFilterProps<TData, TValue>) {
  const filterValue = column.getFilterValue() as DateRangeFilter | undefined;

  const dateRange: DateRange | undefined = React.useMemo(() => {
    if (!filterValue?.from && !filterValue?.to) return undefined;
    return {
      from: filterValue.from ? new Date(filterValue.from) : undefined,
      to: filterValue.to ? new Date(filterValue.to) : undefined,
    };
  }, [filterValue]);

  const handleSelect = (range: DateRange | undefined) => {
    if (!range) {
      column.setFilterValue(undefined);
      return;
    }
    column.setFilterValue({
      from: range.from?.toISOString(),
      to: range.to?.toISOString(),
    } as DateRangeFilter);
  };

  const handlePreset = (preset: (typeof presets)[number]) => {
    const range = preset.getValue();
    column.setFilterValue({
      from: range.from.toISOString(),
      to: range.to.toISOString(),
    } as DateRangeFilter);
  };

  const handleClear = () => {
    column.setFilterValue(undefined);
  };

  const hasFilter = filterValue?.from || filterValue?.to;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-1 px-1">
        {presets.map((preset) => (
          <Button
            key={preset.label}
            variant="outline"
            size="xs"
            onClick={() => handlePreset(preset)}
          >
            {preset.label}
          </Button>
        ))}
      </div>
      <Calendar
        mode="range"
        selected={dateRange}
        onSelect={handleSelect}
        numberOfMonths={1}
        defaultMonth={dateRange?.from}
      />
      {hasFilter && (
        <div className="px-1 pb-1">
          <div className="mb-2 text-xs text-muted-foreground text-center">
            {dateRange?.from && format(dateRange.from, "MMM d, yyyy")}
            {dateRange?.from && dateRange?.to && " - "}
            {dateRange?.to && format(dateRange.to, "MMM d, yyyy")}
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleClear}
            className="h-7 w-full"
          >
            <IconX className="size-3" />
            Clear
          </Button>
        </div>
      )}
    </div>
  );
}
