import { z } from "zod";

export const registerSchema = z
  .object({
    privateKey: z.string().min(32, "Invalid private key").optional(),
    generateWallet: z.boolean().default(false),
    accountName: z
      .string()
      .min(1, "Account name is required")
      .max(100, "Account name is too long"),
  })
  .refine(
    (data) => {
      if (!data.generateWallet && !data.privateKey) {
        return false;
      }
      if (data.generateWallet && data.privateKey) {
        return false;
      }
      return true;
    },
    {
      message:
        "Either provide a private key or request wallet generation, not both",
      path: ["privateKey"],
    }
  );

export const loginWithPrivateKeySchema = z.object({
  privateKey: z.string().min(32, "Invalid private key"),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginWithPrivateKeyInput = z.infer<
  typeof loginWithPrivateKeySchema
>;

export type AuthUserOutput = {
  id: string;
  name: string;
  mainWalletPublicKey: string;
  mainWalletBalanceSol: number;
  createdAt: Date;
  updatedAt: Date;
  generatedWallet?: {
    publicKey: string;
    privateKey: string;
  };
};
