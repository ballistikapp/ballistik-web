import { z } from "zod";

export const getWalletsByTokenSchema = z.object({
  tokenPublicKey: z.string().min(1, "Token public key is required"),
});

export type GetWalletsByTokenInput = z.infer<typeof getWalletsByTokenSchema>;
