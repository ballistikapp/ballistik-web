"use client";

import * as React from "react";
import { useQueryState, parseAsInteger, parseAsString, createParser } from "nuqs";
import type {
  ColumnFiltersState,
  PaginationState,
  SortingState,
} from "@tanstack/react-table";

const parseAsColumnFilters = createParser<ColumnFiltersState>({
  parse: (value) => {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) {
        return parsed as ColumnFiltersState;
      }
      return null;
    } catch {
      return null;
    }
  },
  serialize: (value) => JSON.stringify(value),
});

export interface UseDataTableParamsOptions {
  defaultPageSize?: number;
  prefix?: string;
}

export function useDataTableParams(options: UseDataTableParamsOptions = {}) {
  const { defaultPageSize = 10, prefix } = options;

  const pageKey = prefix ? `${prefix}_page` : "page";
  const pageSizeKey = prefix ? `${prefix}_pageSize` : "pageSize";
  const sortKey = prefix ? `${prefix}_sort` : "sort";
  const filtersKey = prefix ? `${prefix}_filters` : "filters";
  const searchKey = prefix ? `${prefix}_search` : "search";

  const [page, setPage] = useQueryState(
    pageKey,
    parseAsInteger.withDefault(0).withOptions({ history: "replace", shallow: true })
  );

  const [pageSize, setPageSize] = useQueryState(
    pageSizeKey,
    parseAsInteger.withDefault(defaultPageSize).withOptions({ history: "replace", shallow: true })
  );

  const [sort, setSort] = useQueryState(
    sortKey,
    parseAsString.withOptions({ history: "replace", shallow: true })
  );

  const [filters, setFilters] = useQueryState(
    filtersKey,
    parseAsColumnFilters.withOptions({ history: "replace", shallow: true })
  );

  const [search, setSearch] = useQueryState(
    searchKey,
    parseAsString.withOptions({ history: "replace", shallow: true })
  );

  const pagination: PaginationState = React.useMemo(
    () => ({
      pageIndex: page,
      pageSize: pageSize,
    }),
    [page, pageSize]
  );

  const sorting: SortingState = React.useMemo(() => {
    if (!sort) return [];
    const [id, direction] = sort.split(":");
    return [{ id, desc: direction === "desc" }];
  }, [sort]);

  const columnFilters: ColumnFiltersState = React.useMemo(
    () => filters ?? [],
    [filters]
  );

  const globalFilter: string = React.useMemo(
    () => search ?? "",
    [search]
  );

  const setPagination = React.useCallback(
    (updater: PaginationState | ((old: PaginationState) => PaginationState)) => {
      const newPagination =
        typeof updater === "function"
          ? updater({ pageIndex: page, pageSize })
          : updater;
      setPage(newPagination.pageIndex || null);
      setPageSize(newPagination.pageSize === defaultPageSize ? null : newPagination.pageSize);
    },
    [page, pageSize, setPage, setPageSize, defaultPageSize]
  );

  const setSorting = React.useCallback(
    (updater: SortingState | ((old: SortingState) => SortingState)) => {
      const currentSorting = sort
        ? [{ id: sort.split(":")[0], desc: sort.split(":")[1] === "desc" }]
        : [];
      const newSorting =
        typeof updater === "function" ? updater(currentSorting) : updater;
      if (newSorting.length === 0) {
        setSort(null);
      } else {
        const s = newSorting[0];
        setSort(`${s.id}:${s.desc ? "desc" : "asc"}`);
      }
    },
    [sort, setSort]
  );

  const setColumnFilters = React.useCallback(
    (updater: ColumnFiltersState | ((old: ColumnFiltersState) => ColumnFiltersState)) => {
      const currentFilters = filters ?? [];
      const newFilters =
        typeof updater === "function" ? updater(currentFilters) : updater;
      setFilters(newFilters.length > 0 ? newFilters : null);
      setPage(0);
    },
    [filters, setFilters, setPage]
  );

  const setGlobalFilter = React.useCallback(
    (value: string | undefined) => {
      setSearch(value || null);
      setPage(0);
    },
    [setSearch, setPage]
  );

  const resetAll = React.useCallback(() => {
    setPage(null);
    setPageSize(null);
    setSort(null);
    setFilters(null);
    setSearch(null);
  }, [setPage, setPageSize, setSort, setFilters, setSearch]);

  return {
    pagination,
    sorting,
    columnFilters,
    globalFilter,
    setPagination,
    setSorting,
    setColumnFilters,
    setGlobalFilter,
    resetAll,
  };
}
