import { z } from "zod";

export const listHoldingsByTokenSchema = z.object({
  tokenPublicKey: z.string().min(1, "Token public key is required"),
  walletPublicKey: z.string().min(1).optional(),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(10),
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
  closeAta: z.boolean().optional().default(false),
  returnSolToMainWallet: z.boolean().optional().default(false),
});

export type SellHoldingsByTokenInput = z.infer<
  typeof sellHoldingsByTokenSchema
>;

export const startExitSchema = z.object({
  tokenPublicKey: z.string().min(1, "Token public key is required"),
  jitoTipSol: z.number().min(0).max(1).default(0.005),
  returnSolToMainWallet: z.boolean().optional().default(false),
});

export type StartExitInput = z.infer<typeof startExitSchema>;

export const exitStatusSchema = z.object({
  exitId: z.string().min(1, "Exit id is required"),
});

export type ExitStatusInput = z.infer<typeof exitStatusSchema>;

export const activeExitSchema = z.object({
  tokenPublicKey: z.string().min(1, "Token public key is required"),
});

export type ActiveExitInput = z.infer<typeof activeExitSchema>;

export const cancelExitSchema = z.object({
  exitId: z.string().min(1, "Exit id is required"),
});

export type CancelExitInput = z.infer<typeof cancelExitSchema>;
