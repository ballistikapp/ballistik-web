"use client";

import * as React from "react";
import { IconAlertCircle, IconRefresh } from "@tabler/icons-react";

import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";

interface TokenErrorProps {
  title?: string;
  description?: string;
  onRetry?: () => void;
  retryLabel?: string;
}

export function TokenError({
  title = "Error Loading Token",
  description = "An error occurred while loading the token. Please try again later.",
  onRetry,
  retryLabel = "Try Again",
}: TokenErrorProps) {
  return (
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <IconAlertCircle />
        </EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
      {onRetry && (
        <EmptyContent>
          <Button
            onClick={onRetry}
            size="lg"
            className="w-full max-w-md h-12 text-lg font-semibold"
          >
            <IconRefresh className="mr-2 size-4" />
            {retryLabel}
          </Button>
        </EmptyContent>
      )}
    </Empty>
  );
}
