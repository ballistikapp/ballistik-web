"use client";

import * as React from "react";
import { type Column } from "@tanstack/react-table";
import { format, subMinutes, subHours } from "date-fns";
import { IconX } from "@tabler/icons-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { DateRangeFilter } from "../types";

interface DateColumnFilterProps<TData, TValue> {
  column: Column<TData, TValue>;
}

const presets = [
  {
    key: "1m",
    label: "1m",
    getValue: () => ({
      from: subMinutes(new Date(), 1),
      to: new Date(),
    }),
  },
  {
    key: "10m",
    label: "10m",
    getValue: () => ({
      from: subMinutes(new Date(), 10),
      to: new Date(),
    }),
  },
  {
    key: "1h",
    label: "1h",
    getValue: () => ({
      from: subHours(new Date(), 1),
      to: new Date(),
    }),
  },
  {
    key: "24h",
    label: "24h",
    getValue: () => ({
      from: subHours(new Date(), 24),
      to: new Date(),
    }),
  },
] as const;

function toLocalDatetimeString(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function DateColumnFilter<TData, TValue>({
  column,
}: DateColumnFilterProps<TData, TValue>) {
  const filterValue = column.getFilterValue() as DateRangeFilter | undefined;
  const [activePreset, setActivePreset] = React.useState<string>("");

  const fromDate = React.useMemo(
    () => (filterValue?.from ? new Date(filterValue.from) : undefined),
    [filterValue?.from]
  );
  const toDate = React.useMemo(
    () => (filterValue?.to ? new Date(filterValue.to) : undefined),
    [filterValue?.to]
  );

  const handlePresetChange = (value: string) => {
    setActivePreset(value);
    if (!value) {
      column.setFilterValue(undefined);
      return;
    }
    const preset = presets.find((p) => p.key === value);
    if (!preset) return;
    const range = preset.getValue();
    column.setFilterValue({
      from: range.from.toISOString(),
      to: range.to.toISOString(),
    } as DateRangeFilter);
  };

  const handleFromChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setActivePreset("");
    const value = e.target.value;
    if (!value) {
      column.setFilterValue((old: DateRangeFilter | undefined) => {
        if (!old?.to) return undefined;
        return { to: old.to } as DateRangeFilter;
      });
      return;
    }
    const date = new Date(value);
    column.setFilterValue((old: DateRangeFilter | undefined) => ({
      ...old,
      from: date.toISOString(),
    }));
  };

  const handleToChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setActivePreset("");
    const value = e.target.value;
    if (!value) {
      column.setFilterValue((old: DateRangeFilter | undefined) => {
        if (!old?.from) return undefined;
        return { from: old.from } as DateRangeFilter;
      });
      return;
    }
    const date = new Date(value);
    column.setFilterValue((old: DateRangeFilter | undefined) => ({
      ...old,
      to: date.toISOString(),
    }));
  };

  const handleClear = () => {
    setActivePreset("");
    column.setFilterValue(undefined);
  };

  const hasFilter = filterValue?.from || filterValue?.to;

  return (
    <div className="flex flex-col gap-0">
      <div className="flex items-center justify-between px-3 pt-3 pb-2">
        <span className="text-xs font-medium text-muted-foreground">
          Time range
        </span>
        {hasFilter && (
          <Button
            variant="ghost"
            size="xs"
            onClick={handleClear}
            className="h-5 gap-1 px-1.5 text-muted-foreground hover:text-foreground"
          >
            <IconX className="size-3" />
            Clear
          </Button>
        )}
      </div>

      <div className="px-3 pb-3">
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          value={activePreset}
          onValueChange={handlePresetChange}
          className="w-full"
        >
          {presets.map((preset) => (
            <ToggleGroupItem
              key={preset.key}
              value={preset.key}
              className="flex-1 text-xs"
            >
              {preset.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>

      {hasFilter && fromDate && (
        <div className="mx-3 mb-3 rounded-md bg-muted/50 px-2.5 py-1.5 text-center text-xs tabular-nums text-foreground">
          {format(fromDate, "MMM d, HH:mm")}
          {toDate && (
            <>
              {" "}
              <span className="text-muted-foreground/60">&ndash;</span>{" "}
              {format(toDate, "MMM d, HH:mm")}
            </>
          )}
        </div>
      )}

      <Separator />

      <div className="flex flex-col gap-2 p-3">
        <span className="text-[11px] font-medium text-muted-foreground/70">
          Custom range
        </span>
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-2">
            <span className="w-8 shrink-0 text-[11px] text-muted-foreground">
              From
            </span>
            <Input
              type="datetime-local"
              value={fromDate ? toLocalDatetimeString(fromDate) : ""}
              onChange={handleFromChange}
              className="h-7 text-xs"
            />
          </div>
          <div className="flex items-center gap-2">
            <span className="w-8 shrink-0 text-[11px] text-muted-foreground">
              To
            </span>
            <Input
              type="datetime-local"
              value={toDate ? toLocalDatetimeString(toDate) : ""}
              onChange={handleToChange}
              className="h-7 text-xs"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
