"use client";

import { IconFolderCode, IconAlertTriangle } from "@tabler/icons-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { trpc } from "@/lib/trpc/client";

type Props = {
  error?: {
    message: string;
    data?: {
      code?: string;
    } | null;
  } | null;
  onRetry?: () => void;
};

export function TokenNotFound({ error, onRetry }: Props) {
  const { data: currentUser, isLoading: isAuthLoading } =
    trpc.auth.me.useQuery();
  const { data: tokensData, isLoading: isTokensLoading } =
    trpc.token.getUserTokens.useQuery(undefined, {
      enabled: !!currentUser,
      retry: false,
    });

  const isAuthenticated = !!currentUser;
  const hasTokens = (tokensData?.totalCount ?? 0) > 0;
  const isLoading = isAuthLoading || isTokensLoading;

  const errorCode = error?.data?.code;
  const isExpectedError =
    !error || (errorCode !== "NOT_FOUND" && errorCode !== "UNAUTHORIZED");

  if (isLoading) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <IconFolderCode />
          </EmptyMedia>
          <EmptyTitle>Loading...</EmptyTitle>
        </EmptyHeader>
      </Empty>
    );
  }

  if (!isExpectedError) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <IconAlertTriangle />
          </EmptyMedia>
          <EmptyTitle>Something went wrong</EmptyTitle>
          <EmptyDescription>
            {error?.message || "An error occurred. Please try again."}
          </EmptyDescription>
        </EmptyHeader>
        {onRetry && (
          <EmptyContent>
            <Button onClick={onRetry} size="lg" className="h-12 text-lg">
              Try Again
            </Button>
          </EmptyContent>
        )}
      </Empty>
    );
  }

  return (
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <IconFolderCode />
        </EmptyMedia>
        <EmptyTitle>Token Not Found</EmptyTitle>
        <EmptyDescription>
          {!isAuthenticated
            ? "Please log in to view your tokens or launch a new one."
            : hasTokens
              ? "Please select a token from the sidebar to view its details."
              : "You haven't created any tokens yet. Launch your first token to get started."}
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <div className="flex flex-col gap-4 w-full items-center">
          <Button
            asChild
            size="lg"
            className="w-full max-w-md h-12 text-lg font-semibold"
          >
            <Link href="/launch">Launch New Token</Link>
          </Button>
          {!isAuthenticated && (
            <Button
              asChild
              variant="outline"
              size="lg"
              className="w-full max-w-md h-12 text-lg"
            >
              <Link href="/auth">Login</Link>
            </Button>
          )}
        </div>
      </EmptyContent>
    </Empty>
  );
}
