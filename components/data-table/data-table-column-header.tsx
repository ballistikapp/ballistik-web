"use client";

import * as React from "react";
import { type Column } from "@tanstack/react-table";
import {
  IconArrowDown,
  IconArrowUp,
  IconArrowsUpDown,
  IconEyeOff,
  IconFilter,
  IconFilterFilled,
} from "@tabler/icons-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { TextColumnFilter } from "./filters/text-column-filter";
import { NumberColumnFilter } from "./filters/number-column-filter";
import { DateColumnFilter } from "./filters/date-column-filter";
import type { ColumnFilterMeta } from "./types";

interface DataTableColumnHeaderProps<TData, TValue>
  extends React.HTMLAttributes<HTMLDivElement> {
  column: Column<TData, TValue>;
  title: string;
}

export function DataTableColumnHeader<TData, TValue>({
  column,
  title,
  className,
}: DataTableColumnHeaderProps<TData, TValue>) {
  const filterMeta = column.columnDef.meta?.filter as ColumnFilterMeta | undefined;
  const isFiltered = column.getIsFiltered();

  const renderFilter = () => {
    if (!filterMeta) return null;

    switch (filterMeta.filterType) {
      case "text":
        return <TextColumnFilter column={column} />;
      case "number":
        return <NumberColumnFilter column={column} />;
      case "date":
        return <DateColumnFilter column={column} />;
      default:
        return null;
    }
  };

  if (!column.getCanSort() && !filterMeta) {
    return <div className={cn(className)}>{title}</div>;
  }

  return (
    <div className={cn("flex items-center gap-1", className)}>
      {column.getCanSort() ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="data-[state=open]:bg-accent -ml-3 h-8"
            >
              <span>{title}</span>
              {column.getIsSorted() === "desc" ? (
                <IconArrowDown className="size-4" />
              ) : column.getIsSorted() === "asc" ? (
                <IconArrowUp className="size-4" />
              ) : (
                <IconArrowsUpDown className="size-4" />
              )}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuItem onClick={() => column.toggleSorting(false)}>
              <IconArrowUp className="text-muted-foreground/70 size-4" />
              Asc
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => column.toggleSorting(true)}>
              <IconArrowDown className="text-muted-foreground/70 size-4" />
              Desc
            </DropdownMenuItem>
            {column.getCanHide() && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => column.toggleVisibility(false)}>
                  <IconEyeOff className="text-muted-foreground/70 size-4" />
                  Hide
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : (
        <span className="-ml-3 px-3">{title}</span>
      )}

      {filterMeta && (
        <Popover>
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              size="icon-xs"
              className={cn(
                "size-6",
                isFiltered && "text-primary"
              )}
            >
              {isFiltered ? (
                <IconFilterFilled className="size-3.5" />
              ) : (
                <IconFilter className="size-3.5" />
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent
            align="start"
            className={cn(
              "p-0",
              filterMeta.filterType === "text" && "w-56",
              filterMeta.filterType === "number" && "w-48",
              filterMeta.filterType === "date" && "w-auto"
            )}
          >
            {renderFilter()}
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
}
