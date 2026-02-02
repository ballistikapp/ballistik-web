import { z } from "zod";

export const listTransactionsByTokenSchema = z.object({
  tokenPublicKey: z.string().min(1, "Token public key is required"),
  walletPublicKey: z.string().min(1).optional(),
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

export const liveTransactionsByTokenSchema = z.object({
  tokenPublicKey: z.string().min(1, "Token public key is required"),
  limit: z.number().int().min(10).max(200).optional(),
});

export type LiveTransactionsByTokenInput = z.infer<
  typeof liveTransactionsByTokenSchema
>;
