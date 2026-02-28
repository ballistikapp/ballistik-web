"use client";

import * as React from "react";
import {
  flexRender,
  getCoreRowModel,
  getFacetedRowModel,
  getFacetedUniqueValues,
  getFacetedMinMaxValues,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type ColumnFiltersState,
  type FilterFn,
  type PaginationState,
  type SortingState,
  type Table as TanstackTable,
  type VisibilityState,
} from "@tanstack/react-table";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
} from "@/components/ui/empty";
import { useDataTableParams } from "./use-data-table-params";
import type { NumberRangeFilter, DateRangeFilter } from "./types";

const numberRangeFilter: FilterFn<unknown> = (row, columnId, filterValue: NumberRangeFilter) => {
  const value = row.getValue(columnId) as number;
  const { min, max } = filterValue;

  if (min !== undefined && max !== undefined) {
    return value >= min && value <= max;
  }
  if (min !== undefined) {
    return value >= min;
  }
  if (max !== undefined) {
    return value <= max;
  }
  return true;
};

const dateRangeFilter: FilterFn<unknown> = (row, columnId, filterValue: DateRangeFilter) => {
  const value = row.getValue(columnId);
  if (!value) return true;

  const dateValue = new Date(value as string | number | Date);
  const { from, to } = filterValue;

  if (from && to) {
    return dateValue >= new Date(from) && dateValue <= new Date(to);
  }
  if (from) {
    return dateValue >= new Date(from);
  }
  if (to) {
    return dateValue <= new Date(to);
  }
  return true;
};

const textArrayFilter: FilterFn<unknown> = (row, columnId, filterValue: string[]) => {
  if (!filterValue || filterValue.length === 0) return true;
  const value = String(row.getValue(columnId));
  return filterValue.includes(value);
};

interface DataTableProps<TData, TValue> {
  columns: ColumnDef<TData, TValue>[];
  data: TData[];
  isLoading?: boolean;
  toolbar?: (table: TanstackTable<TData>) => React.ReactNode;
  pagination?: (table: TanstackTable<TData>) => React.ReactNode;
  getRowId?: (row: TData) => string;
  initialSorting?: SortingState;
  initialColumnVisibility?: VisibilityState;
  initialPagination?: PaginationState;
  enableRowSelection?: boolean;
  onRowSelectionChange?: (selection: Record<string, boolean>) => void;
  searchableColumns?: string[];
  enableUrlState?: boolean;
  urlStatePrefix?: string;
  onPaginationStateChange?: (pagination: PaginationState) => void;
  manualPagination?: boolean;
  pageCount?: number;
  rowCount?: number;
  isRefreshing?: boolean;
}

export function DataTable<TData, TValue>({
  columns,
  data,
  isLoading = false,
  toolbar,
  pagination: paginationSlot,
  getRowId,
  initialSorting = [],
  initialColumnVisibility = {},
  initialPagination = { pageIndex: 0, pageSize: 25 },
  enableRowSelection = false,
  onRowSelectionChange,
  searchableColumns,
  enableUrlState = false,
  urlStatePrefix,
  onPaginationStateChange,
  manualPagination = false,
  pageCount,
  rowCount,
  isRefreshing = false,
}: DataTableProps<TData, TValue>) {
  const urlState = useDataTableParams({
    defaultPageSize: initialPagination.pageSize,
    prefix: urlStatePrefix,
  });

  const [rowSelection, setRowSelection] = React.useState({});
  const [columnVisibility, setColumnVisibility] =
    React.useState<VisibilityState>(initialColumnVisibility);

  const [localColumnFilters, setLocalColumnFilters] = React.useState<ColumnFiltersState>([]);
  const [localSorting, setLocalSorting] = React.useState<SortingState>(initialSorting);
  const [localPagination, setLocalPagination] = React.useState<PaginationState>(initialPagination);
  const [localGlobalFilter, setLocalGlobalFilter] = React.useState("");

  const sorting = enableUrlState ? urlState.sorting : localSorting;
  const columnFilters = enableUrlState ? urlState.columnFilters : localColumnFilters;
  const pagination = enableUrlState ? urlState.pagination : localPagination;
  const globalFilter = enableUrlState ? urlState.globalFilter : localGlobalFilter;

  const setSorting = enableUrlState ? urlState.setSorting : setLocalSorting;
  const setColumnFilters = enableUrlState ? urlState.setColumnFilters : setLocalColumnFilters;
  const setPagination = enableUrlState ? urlState.setPagination : setLocalPagination;
  const setGlobalFilter = enableUrlState ? urlState.setGlobalFilter : setLocalGlobalFilter;

  React.useEffect(() => {
    onRowSelectionChange?.(rowSelection);
  }, [rowSelection, onRowSelectionChange]);

  React.useEffect(() => {
    onPaginationStateChange?.(pagination);
  }, [onPaginationStateChange, pagination]);

  const globalFilterFn = React.useMemo<FilterFn<TData>>(() => {
    return (row, _columnId, filterValue: string) => {
      if (!filterValue) return true;
      const searchValue = filterValue.toLowerCase();
      const columnsToSearch = searchableColumns ?? columns.map((c) => {
        if ("accessorKey" in c && typeof c.accessorKey === "string") {
          return c.accessorKey;
        }
        return c.id;
      }).filter(Boolean) as string[];

      return columnsToSearch.some((columnId) => {
        const value = row.getValue(columnId);
        if (value == null) return false;
        return String(value).toLowerCase().includes(searchValue);
      });
    };
  }, [columns, searchableColumns]);

  const table = useReactTable({
    data,
    columns,
    state: {
      sorting,
      columnVisibility,
      rowSelection,
      columnFilters,
      pagination,
      globalFilter,
    },
    getRowId,
    enableRowSelection,
    onRowSelectionChange: setRowSelection,
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onColumnVisibilityChange: setColumnVisibility,
    onPaginationChange: setPagination,
    onGlobalFilterChange: setGlobalFilter,
    globalFilterFn,
    manualPagination,
    ...(manualPagination
      ? {
          pageCount,
          rowCount,
        }
      : {}),
    filterFns: {
      numberRange: numberRangeFilter,
      dateRange: dateRangeFilter,
      textArray: textArrayFilter,
    },
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFacetedRowModel: getFacetedRowModel(),
    getFacetedUniqueValues: getFacetedUniqueValues(),
    getFacetedMinMaxValues: getFacetedMinMaxValues(),
  });

  const hasRows = table.getRowModel().rows.length > 0;
  const showSkeletonRows = isLoading && !hasRows;
  const showLoadingPulse = isRefreshing && hasRows;

  return (
    <div className="flex flex-col gap-4">
      {toolbar?.(table)}
      <div
        className={`overflow-hidden rounded-lg border transition-opacity ${
          showLoadingPulse ? "animate-pulse opacity-80" : ""
        }`}
      >
        <Table>
          <TableHeader className="bg-muted">
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <TableHead key={header.id} colSpan={header.colSpan}>
                    {header.isPlaceholder
                      ? null
                      : flexRender(
                          header.column.columnDef.header,
                          header.getContext()
                        )}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {showSkeletonRows ? (
              Array.from({ length: 3 }).map((_, index) => (
                <TableRow key={`skeleton-${index}`}>
                  {columns.map((_, colIndex) => (
                    <TableCell key={colIndex}>
                      <Skeleton className="h-4 w-full" />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : hasRows ? (
              table.getRowModel().rows.map((row) => (
                <TableRow
                  key={row.id}
                  data-state={row.getIsSelected() && "selected"}
                >
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id}>
                      {flexRender(
                        cell.column.columnDef.cell,
                        cell.getContext()
                      )}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={columns.length} className="p-0">
                  <Empty className="min-h-[144px] border-0 rounded-none">
                    <EmptyHeader>
                      <EmptyTitle>No results found</EmptyTitle>
                      <EmptyDescription>
                        No data available to display.
                      </EmptyDescription>
                    </EmptyHeader>
                  </Empty>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      {paginationSlot?.(table)}
    </div>
  );
}
