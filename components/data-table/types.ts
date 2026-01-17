import type { RowData, FilterFns } from "@tanstack/react-table";

export type FilterType = "text" | "number" | "date";

declare module "@tanstack/react-table" {
  interface FilterFns {
    textArray: unknown;
    numberRange: unknown;
    dateRange: unknown;
  }
}

export interface TextFilterMeta {
  filterType: "text";
}

export interface NumberFilterMeta {
  filterType: "number";
  min?: number;
  max?: number;
}

export interface DateFilterMeta {
  filterType: "date";
  minDate?: Date;
  maxDate?: Date;
}

export type ColumnFilterMeta = TextFilterMeta | NumberFilterMeta | DateFilterMeta;

export interface DataTableColumnMeta {
  filter?: ColumnFilterMeta;
  searchable?: boolean;
}

export interface NumberRangeFilter {
  min?: number;
  max?: number;
}

export interface DateRangeFilter {
  from?: string;
  to?: string;
}

declare module "@tanstack/react-table" {
  interface ColumnMeta<TData extends RowData, TValue>
    extends DataTableColumnMeta {}
}
