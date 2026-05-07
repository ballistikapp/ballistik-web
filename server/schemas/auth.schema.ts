import { z } from "zod";
import type { UserPlan } from "@/lib/generated/prisma/client";

export const loginWithPrivateKeySchema = z.object({
  privateKey: z.string().min(32, "Invalid private key"),
});

export const refreshSessionSchema = z.object({});

export const walletAuthPurposeSchema = z.enum(["WALLET_LOGIN", "WALLET_LINK"]);
export const walletAuthIntentSchema = z.enum(["login", "register"]);

export const createWalletChallengeSchema = z.object({
  publicKey: z.string().min(32, "Invalid wallet public key"),
  purpose: walletAuthPurposeSchema,
});

export const loginWithWalletSignatureSchema = z.object({
  publicKey: z.string().min(32, "Invalid wallet public key"),
  nonce: z.string().min(16, "Invalid auth challenge"),
  signature: z.string().min(32, "Invalid wallet signature"),
  intent: walletAuthIntentSchema.default("login"),
  accountName: z.string().max(100, "Account name is too long").optional(),
});

export const linkWalletAdapterSchema = z.object({
  publicKey: z.string().min(32, "Invalid wallet public key"),
  nonce: z.string().min(16, "Invalid auth challenge"),
  signature: z.string().min(32, "Invalid wallet signature"),
});

export type LoginWithPrivateKeyInput = z.infer<
  typeof loginWithPrivateKeySchema
>;
export type CreateWalletChallengeInput = z.infer<
  typeof createWalletChallengeSchema
>;
export type LoginWithWalletSignatureInput = z.infer<
  typeof loginWithWalletSignatureSchema
>;
export type LinkWalletAdapterInput = z.infer<typeof linkWalletAdapterSchema>;

export type AuthUserOutput = {
  id: string;
  name: string;
  plan: UserPlan;
  mainWalletPublicKey: string;
  authWalletPublicKey: string | null;
  mainWalletBalanceSol: number;
  createdAt: Date;
  updatedAt: Date;
  generatedWallet?: {
    publicKey: string;
    privateKey: string;
  };
};

export type ContextUser = {
  id: string;
  name: string;
  plan: UserPlan;
  mainWalletPublicKey: string;
  authWalletPublicKey?: string | null;
};

export const updateNameSchema = z.object({
  name: z.string().min(1, "Name is required").max(50, "Name is too long"),
});

export type UpdateNameInput = z.infer<typeof updateNameSchema>;
