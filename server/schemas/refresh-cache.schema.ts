import { z } from "zod";

export const refreshScopeSchema = z.enum([
  "TRANSACTIONS",
  "HOLDINGS",
  "WALLETS",
]);

export const getRefreshCacheSchema = z.object({
  tokenPublicKey: z.string().min(1, "Token public key is required"),
  scope: refreshScopeSchema,
});

export type GetRefreshCacheInput = z.infer<typeof getRefreshCacheSchema>;
