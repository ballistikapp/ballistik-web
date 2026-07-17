import { z } from "zod";

const publicKeySchema = z.string().min(32, "Invalid public key");

const opsListBaseSchema = z.object({
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(25),
  search: z.string().trim().min(1).max(200).optional(),
  sortDir: z.enum(["asc", "desc"]).default("desc"),
});

export const opsGetOverviewSchema = z.object({});

export const opsListUsersSchema = opsListBaseSchema.extend({
  sortBy: z.enum(["createdAt", "name", "plan"]).default("createdAt"),
});

export const opsListLaunchesSchema = opsListBaseSchema.extend({
  sortBy: z.enum(["createdAt", "startedAt", "status"]).default("createdAt"),
});

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

export type OpsGetOverviewInput = z.infer<typeof opsGetOverviewSchema>;
/** Input shape before Zod defaults (`page`/`pageSize`/`sort*`). */
export type OpsListUsersInput = z.input<typeof opsListUsersSchema>;
/** Input shape before Zod defaults (`page`/`pageSize`/`sort*`). */
export type OpsListLaunchesInput = z.input<typeof opsListLaunchesSchema>;
export type OpsLookupInput = z.infer<typeof opsLookupSchema>;
export type OpsGetUserSpineInput = z.infer<typeof opsGetUserSpineSchema>;
export type OpsGetLaunchAutopsyInput = z.infer<typeof opsGetLaunchAutopsySchema>;
export type OpsRevealPrivateKeyInput = z.infer<typeof opsRevealPrivateKeySchema>;
