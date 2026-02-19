"use client";

import * as React from "react";
import { type Column } from "@tanstack/react-table";
import { IconX } from "@tabler/icons-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { NumberRangeFilter } from "../types";

interface NumberColumnFilterProps<TData, TValue> {
  column: Column<TData, TValue>;
}

export function NumberColumnFilter<TData, TValue>({
  column,
}: NumberColumnFilterProps<TData, TValue>) {
  const filterValue = column.getFilterValue() as NumberRangeFilter | undefined;
  const facetedMinMax = column.getFacetedMinMaxValues();
  const minMax: [number | undefined, number | undefined] = facetedMinMax
    ? [facetedMinMax[0], facetedMinMax[1]]
    : [undefined, undefined];

  const minValue = filterValue?.min ?? "";
  const maxValue = filterValue?.max ?? "";

  const handleMinChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    const numValue = value === "" ? undefined : Number(value);
    column.setFilterValue((old: NumberRangeFilter | undefined) => ({
      ...old,
      min: numValue,
    }));
  };

  const handleMaxChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    const numValue = value === "" ? undefined : Number(value);
    column.setFilterValue((old: NumberRangeFilter | undefined) => ({
      ...old,
      max: numValue,
    }));
  };

  const handleClear = () => {
    column.setFilterValue(undefined);
  };

  const hasFilter =
    filterValue?.min !== undefined || filterValue?.max !== undefined;

  const formatHint = (value: number | undefined) => {
    if (value === undefined) return null;
    return value.toLocaleString();
  };

  return (
    <div className="flex flex-col gap-3 p-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">Range</span>
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

      <div className="flex items-center gap-2">
        <Input
          type="number"
          placeholder={minMax[0] !== undefined ? String(minMax[0]) : "Min"}
          value={minValue}
          onChange={handleMinChange}
          className="h-8 text-xs"
        />
        <span className="text-muted-foreground/60 shrink-0">&ndash;</span>
        <Input
          type="number"
          placeholder={minMax[1] !== undefined ? String(minMax[1]) : "Max"}
          value={maxValue}
          onChange={handleMaxChange}
          className="h-8 text-xs"
        />
      </div>

      {minMax[0] !== undefined && minMax[1] !== undefined && (
        <p className="text-[11px] text-muted-foreground/50">
          {formatHint(minMax[0])} &ndash; {formatHint(minMax[1])}
        </p>
      )}
    </div>
  );
}
