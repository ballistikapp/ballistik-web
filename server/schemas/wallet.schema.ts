import { z } from "zod";

export const getOperationalWalletsByTokenSchema = z.object({
  tokenPublicKey: z.string().min(1, "Token public key is required"),
});

export type GetOperationalWalletsByTokenInput = z.infer<
  typeof getOperationalWalletsByTokenSchema
>;

export const getDevWalletByTokenSchema = z.object({
  tokenPublicKey: z.string().min(1, "Token public key is required"),
});

export type GetDevWalletByTokenInput = z.infer<
  typeof getDevWalletByTokenSchema
>;

export const getMainWalletSchema = z.object({});

export const getWalletByTokenSchema = z.object({
  tokenPublicKey: z.string().min(1, "Token public key is required"),
  walletPublicKey: z.string().min(1, "Wallet public key is required"),
});

export type GetWalletByTokenInput = z.infer<typeof getWalletByTokenSchema>;

export const getWalletPrivateKeySchema = z.object({
  tokenPublicKey: z.string().min(1, "Token public key is required"),
  walletPublicKey: z.string().min(1, "Wallet public key is required"),
});

export type GetWalletPrivateKeyInput = z.infer<
  typeof getWalletPrivateKeySchema
>;

export const refreshWalletBalancesSchema = z.object({
  tokenPublicKey: z.string().min(1, "Token public key is required"),
  walletPublicKeys: z.array(z.string().min(1)).optional(),
});

export const refreshMainWalletBalanceSchema = z.object({});

export type RefreshWalletBalancesInput = z.infer<
  typeof refreshWalletBalancesSchema
>;

export type RefreshMainWalletBalanceInput = z.infer<
  typeof refreshMainWalletBalanceSchema
>;

export const sendSolSchema = z.object({
  tokenPublicKey: z.string().min(1, "Token public key is required"),
  walletPublicKeys: z.array(z.string().min(1)).min(1),
  amountSol: z.number().positive(),
});

export type SendSolInput = z.infer<typeof sendSolSchema>;

export const returnSolSchema = z
  .object({
    tokenPublicKey: z.string().min(1, "Token public key is required"),
    walletPublicKeys: z.array(z.string().min(1)).min(1),
    amountSol: z.number().positive().optional(),
    useMax: z.boolean().optional(),
  })
  .superRefine((data, ctx) => {
    if (!data.useMax && !data.amountSol) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Amount in SOL is required",
        path: ["amountSol"],
      });
    }
  });

export type ReturnSolInput = z.infer<typeof returnSolSchema>;
