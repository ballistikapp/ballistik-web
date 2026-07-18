import { z } from "zod";
import { PublicKey } from "@solana/web3.js";

export const referralCodeSchema = z
  .string()
  .trim()
  .min(3, "Referral code must be at least 3 characters")
  .max(32, "Referral code must be at most 32 characters")
  .transform((value) => value.toLowerCase())
  .refine(
    (value) => /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value),
    "Use lowercase letters, numbers, and hyphens only (e.g. my-code)"
  );

const feeCollectorPublicKeySchema = z
  .string()
  .trim()
  .min(1, "Fee-collector public key is required")
  .refine((value) => {
    try {
      new PublicKey(value);
      return true;
    } catch {
      return false;
    }
  }, "Invalid Solana public key");

export const marketerUpdateSetupSchema = z
  .object({
    referralCode: referralCodeSchema.optional(),
    feeCollectorPublicKey: feeCollectorPublicKeySchema.optional(),
  })
  .refine(
    (data) =>
      data.referralCode !== undefined ||
      data.feeCollectorPublicKey !== undefined,
    {
      message: "Provide a referral code and/or fee-collector public key",
    }
  );

export type MarketerUpdateSetupInput = z.infer<typeof marketerUpdateSetupSchema>;

export type MarketerReferredUser = {
  referralId: string;
  userId: string;
  name: string;
  mainWalletPublicKey: string;
  joinedAt: Date;
};
