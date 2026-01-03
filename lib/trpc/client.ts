import { createTRPCReact } from "@trpc/react-query";
import { type AppRouter } from "@/server/trpc/routers/_app";

/**
 * Typed tRPC React hooks
 * Use this to call tRPC endpoints from client components
 */
export const trpc = createTRPCReact<AppRouter>();
