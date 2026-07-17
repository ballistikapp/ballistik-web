import { z } from "zod";
import { OPS_WALLET_BALANCE_REFRESH_SELECTION_CAP } from "@/lib/config/ops.config";

export { OPS_WALLET_BALANCE_REFRESH_SELECTION_CAP };

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
  userId: z.string().min(1).optional(),
});

export const opsListTokensSchema = opsListBaseSchema.extend({
  sortBy: z
    .enum(["createdAt", "name", "symbol", "status"])
    .default("createdAt"),
  userId: z.string().min(1).optional(),
});

export const opsListWalletsSchema = opsListBaseSchema.extend({
  sortBy: z.enum(["createdAt", "type", "balanceSol"]).default("createdAt"),
  type: z
    .enum([
      "MAIN_WALLET",
      "DEV",
      "BUNDLER",
      "VOLUME",
      "BUYER",
      "DISTRIBUTION",
    ])
    .optional(),
  isSystemWallet: z.boolean().optional(),
  userId: z.string().min(1).optional(),
});

export const opsGetTokenSchema = z.object({
  publicKey: publicKeySchema,
});

export const opsGetWalletSchema = z.object({
  publicKey: publicKeySchema,
});

export const opsRefreshWalletBalancesSchema = z.object({
  publicKeys: z
    .array(publicKeySchema)
    .min(1)
    .max(OPS_WALLET_BALANCE_REFRESH_SELECTION_CAP),
});

/** Same filters as listWallets, without pagination/sort (filter-wide refresh). */
export const opsRefreshMatchingWalletBalancesSchema = z.object({
  search: z.string().trim().min(1).max(200).optional(),
  type: z
    .enum([
      "MAIN_WALLET",
      "DEV",
      "BUNDLER",
      "VOLUME",
      "BUYER",
      "DISTRIBUTION",
    ])
    .optional(),
  isSystemWallet: z.boolean().optional(),
  userId: z.string().min(1).optional(),
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

export const opsJumpSchema = z.object({
  publicKey: publicKeySchema,
});

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
/** Input shape before Zod defaults (`page`/`pageSize`/`sort*`). */
export type OpsListTokensInput = z.input<typeof opsListTokensSchema>;
/** Input shape before Zod defaults (`page`/`pageSize`/`sort*`). */
export type OpsListWalletsInput = z.input<typeof opsListWalletsSchema>;
export type OpsGetTokenInput = z.infer<typeof opsGetTokenSchema>;
export type OpsGetWalletInput = z.infer<typeof opsGetWalletSchema>;
export type OpsRefreshWalletBalancesInput = z.infer<
  typeof opsRefreshWalletBalancesSchema
>;
export type OpsRefreshMatchingWalletBalancesInput = z.infer<
  typeof opsRefreshMatchingWalletBalancesSchema
>;
export type OpsLookupInput = z.infer<typeof opsLookupSchema>;
export type OpsJumpInput = z.infer<typeof opsJumpSchema>;
export type OpsGetUserSpineInput = z.infer<typeof opsGetUserSpineSchema>;
export type OpsGetLaunchAutopsyInput = z.infer<typeof opsGetLaunchAutopsySchema>;
export type OpsRevealPrivateKeyInput = z.infer<typeof opsRevealPrivateKeySchema>;

export type OpsJumpResult =
  | { kind: "user"; userId: string }
  | { kind: "wallet"; publicKey: string }
  | { kind: "token"; publicKey: string };
