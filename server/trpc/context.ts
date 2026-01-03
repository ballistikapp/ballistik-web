import { type FetchCreateContextFnOptions } from "@trpc/server/adapters/fetch";

/**
 * Creates context for tRPC requests
 * This runs for every tRPC request and provides shared context
 *
 * TODO: Add authentication logic based on your auth solution
 * (e.g., next-auth, clerk, custom JWT, etc.)
 */
export async function createContext(opts?: FetchCreateContextFnOptions) {
  // Example: Get user from session/cookies
  // const cookieStore = await cookies();
  // const sessionToken = cookieStore.get('session')?.value;
  // const user = sessionToken ? await getUserFromSession(sessionToken) : null;

  return {
    // user, // Add when auth is implemented
    headers: opts?.req.headers,
  };
}

export type Context = Awaited<ReturnType<typeof createContext>>;
