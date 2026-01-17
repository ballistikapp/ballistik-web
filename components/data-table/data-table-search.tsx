"use client";

import * as React from "react";
import { type Table } from "@tanstack/react-table";
import { IconSearch, IconX } from "@tabler/icons-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface DataTableSearchProps<TData> {
  table: Table<TData>;
  value?: string;
  onChange?: (value: string) => void;
  placeholder?: string;
  className?: string;
  debounceMs?: number;
}

export function DataTableSearch<TData>({
  table,
  value: externalValue,
  onChange: externalOnChange,
  placeholder = "Search...",
  className,
  debounceMs = 300,
}: DataTableSearchProps<TData>) {
  const isControlled = externalValue !== undefined;
  const [internalValue, setInternalValue] = React.useState("");
  const value = isControlled ? externalValue : internalValue;

  const timeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleChange = (newValue: string) => {
    if (isControlled && externalOnChange) {
      externalOnChange(newValue);
    } else {
      setInternalValue(newValue);
    }

    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    timeoutRef.current = setTimeout(() => {
      table.setGlobalFilter(newValue || undefined);
    }, debounceMs);
  };

  const handleClear = () => {
    handleChange("");
    table.setGlobalFilter(undefined);
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
  };

  React.useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  return (
    <div className={cn("relative", className)}>
      <IconSearch className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        placeholder={placeholder}
        value={value}
        onChange={(e) => handleChange(e.target.value)}
        className="pl-8 pr-8"
      />
      {value && (
        <Button
          variant="ghost"
          size="icon-xs"
          className="absolute right-1 top-1/2 -translate-y-1/2"
          onClick={handleClear}
        >
          <IconX className="size-3" />
        </Button>
      )}
    </div>
  );
}
