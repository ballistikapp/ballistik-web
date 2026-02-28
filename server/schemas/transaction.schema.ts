import { z } from "zod";

export const listTransactionsByTokenSchema = z.object({
  tokenPublicKey: z.string().min(1, "Token public key is required"),
  walletPublicKey: z.string().min(1).optional(),
  groupBySignature: z.boolean().optional(),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(10),
});

export type ListTransactionsByTokenInput = z.infer<
  typeof listTransactionsByTokenSchema
>;

export const refreshTransactionsByTokenSchema = z.object({
  tokenPublicKey: z.string().min(1, "Token public key is required"),
  walletPublicKeys: z.array(z.string().min(1)).optional(),
});

export type RefreshTransactionsByTokenInput = z.infer<
  typeof refreshTransactionsByTokenSchema
>;
