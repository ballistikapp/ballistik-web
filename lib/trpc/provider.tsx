"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
// import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import {
  createTRPCClient,
  httpBatchLink,
  httpSubscriptionLink,
  splitLink,
  type TRPCLink,
} from "@trpc/client";
import { useState } from "react";
import superjson from "superjson";
import { trpc } from "./client";
import { observable } from "@trpc/server/observable";
import type { AppRouter } from "@/server/trpc/routers/_app";

function getBaseUrl() {
  if (typeof window !== "undefined") return "";
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return `http://localhost:${process.env.PORT ?? 3000}`;
}

export function TRPCProvider({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 5 * 60 * 1000,
            refetchOnWindowFocus: false,
          },
        },
      })
  );

  const [trpcClient] = useState(() => {
    const url = `${getBaseUrl()}/api/trpc`;
    const refreshClient = createTRPCClient<AppRouter>({
      links: [
        httpBatchLink({
          url,
          transformer: superjson,
        }),
      ],
    });

    let refreshPromise: Promise<boolean> | null = null;
    const refreshOnUnauthorizedLink: TRPCLink<AppRouter> = () => {
      return ({ op, next }) =>
        observable((observer) => {
          const subscription = next(op).subscribe({
            next(value) {
              observer.next(value);
            },
            complete() {
              observer.complete();
            },
            async error(error) {
              const isUnauthorized =
                typeof error === "object" &&
                error !== null &&
                "data" in error &&
                typeof (error as { data?: { code?: string } }).data?.code ===
                  "string" &&
                (error as { data?: { code?: string } }).data?.code ===
                  "UNAUTHORIZED";
              const alreadyRetried = Boolean(
                (op.context as { hasRefreshed?: boolean } | undefined)
                  ?.hasRefreshed
              );

              if (
                op.type === "subscription" ||
                op.path === "auth.refreshSession" ||
                !isUnauthorized ||
                alreadyRetried
              ) {
                observer.error(error);
                return;
              }

              if (!refreshPromise) {
                refreshPromise = (async () => {
                  try {
                    await refreshClient.auth.refreshSession.mutate({});
                    return true;
                  } catch {
                    return false;
                  } finally {
                    refreshPromise = null;
                  }
                })();
              }

              const refreshed = await refreshPromise;
              if (!refreshed) {
                observer.error(error);
                return;
              }

              next({
                ...op,
                context: {
                  ...(op.context ?? {}),
                  hasRefreshed: true,
                },
              }).subscribe(observer);
            },
          });

          return () => {
            subscription.unsubscribe();
          };
        });
    };

    return trpc.createClient({
      links: [
        refreshOnUnauthorizedLink,
        splitLink({
          condition: (op) => op.type === "subscription",
          true: httpSubscriptionLink({
            url,
            transformer: superjson,
          }),
          false: httpBatchLink({
            url,
            transformer: superjson,
          }),
        }),
      ],
    });
  });

  return (
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        {children}
        {/* <ReactQueryDevtools initialIsOpen={false} /> */}
      </QueryClientProvider>
    </trpc.Provider>
  );
}
