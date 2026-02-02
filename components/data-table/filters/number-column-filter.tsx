"use client";

import * as React from "react";
import { type Column } from "@tanstack/react-table";
import { IconX } from "@tabler/icons-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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

  const hasFilter = filterValue?.min !== undefined || filterValue?.max !== undefined;

  return (
    <div className="flex flex-col gap-3 p-1">
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <Label htmlFor="min-value" className="w-10 text-xs">
            Min
          </Label>
          <Input
            id="min-value"
            type="number"
            placeholder={minMax?.[0] !== undefined ? String(minMax[0]) : "Min"}
            value={minValue}
            onChange={handleMinChange}
            className="h-7 text-xs"
          />
        </div>
        <div className="flex items-center gap-2">
          <Label htmlFor="max-value" className="w-10 text-xs">
            Max
          </Label>
          <Input
            id="max-value"
            type="number"
            placeholder={minMax?.[1] !== undefined ? String(minMax[1]) : "Max"}
            value={maxValue}
            onChange={handleMaxChange}
            className="h-7 text-xs"
          />
        </div>
      </div>
      {hasFilter && (
        <Button
          variant="ghost"
          size="sm"
          onClick={handleClear}
          className="h-7 w-full"
        >
          <IconX className="size-3" />
          Clear
        </Button>
      )}
    </div>
  );
}
