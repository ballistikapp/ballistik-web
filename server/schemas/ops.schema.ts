import { z } from "zod";

const publicKeySchema = z.string().min(32, "Invalid public key");

export const opsLookupSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("mainWallet"),
    publicKey: publicKeySchema,
  }),
  z.object({
    type: z.literal("mint"),
    publicKey: publicKeySchema,
  }),
]);

export const opsGetUserSpineSchema = z.object({
  userId: z.string().min(1),
});

export const opsGetLaunchAutopsySchema = z.object({
  launchId: z.string().min(1),
});

export const opsRevealPrivateKeySchema = z.discriminatedUnion("targetType", [
  z.object({
    targetType: z.literal("wallet"),
    publicKey: publicKeySchema,
  }),
  z.object({
    targetType: z.literal("mint"),
    publicKey: publicKeySchema,
  }),
]);

export type OpsLookupInput = z.infer<typeof opsLookupSchema>;
export type OpsGetUserSpineInput = z.infer<typeof opsGetUserSpineSchema>;
export type OpsGetLaunchAutopsyInput = z.infer<typeof opsGetLaunchAutopsySchema>;
export type OpsRevealPrivateKeyInput = z.infer<typeof opsRevealPrivateKeySchema>;
