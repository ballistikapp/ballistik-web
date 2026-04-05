import { z } from "zod";

export const getCreatorRewardByTokenSchema = z.object({
  tokenPublicKey: z.string().min(1, "Token public key is required"),
});

export type GetCreatorRewardByTokenInput = z.infer<typeof getCreatorRewardByTokenSchema>;

export const refreshCreatorRewardByTokenSchema = z.object({
  tokenPublicKey: z.string().min(1, "Token public key is required"),
});

export type RefreshCreatorRewardByTokenInput = z.infer<typeof refreshCreatorRewardByTokenSchema>;

export const claimCreatorRewardByTokenSchema = z.object({
  tokenPublicKey: z.string().min(1, "Token public key is required"),
});

export type ClaimCreatorRewardByTokenInput = z.infer<typeof claimCreatorRewardByTokenSchema>;
