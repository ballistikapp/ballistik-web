import { z } from "zod";

export const listHoldingsByTokenSchema = z.object({
  tokenPublicKey: z.string().min(1, "Token public key is required"),
  walletPublicKey: z.string().min(1).optional(),
});

export type ListHoldingsByTokenInput = z.infer<
  typeof listHoldingsByTokenSchema
>;

export const refreshHoldingsByTokenSchema = z.object({
  tokenPublicKey: z.string().min(1, "Token public key is required"),
  walletPublicKeys: z.array(z.string().min(1)).optional(),
});

export type RefreshHoldingsByTokenInput = z.infer<
  typeof refreshHoldingsByTokenSchema
>;

export const sellHoldingsByTokenSchema = z.object({
  tokenPublicKey: z.string().min(1, "Token public key is required"),
  walletPublicKeys: z.array(z.string().min(1)).min(1),
  sellPercentage: z.number().min(1).max(100),
});

export type SellHoldingsByTokenInput = z.infer<
  typeof sellHoldingsByTokenSchema
>;
