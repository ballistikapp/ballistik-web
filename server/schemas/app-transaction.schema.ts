import { z } from "zod";

const appTransactionTypeValues = [
  "TRADE_BUY",
  "TRADE_SELL",
  "TRADE_CREATE",
  "TRANSFER_FUND",
  "TRANSFER_RETURN",
  "TRANSFER_RECLAIM",
  "TRANSFER_WITHDRAW",
  "FEE_USAGE",
  "FEE_SUBSCRIPTION",
  "JITO_TIP",
  "TOKEN_DISTRIBUTE",
  "TOKEN_CONSOLIDATE",
  "ACCOUNT_ATA_CREATE",
  "ACCOUNT_ATA_CLOSE",
  "REWARD_CLAIM",
  "REWARD_PAYOUT",
] as const;

const appTransactionSourceValues = [
  "LAUNCH",
  "EXIT",
  "VOLUME_BOT",
  "HOLDING",
  "WALLET",
  "BILLING",
  "CREATOR_REWARD",
] as const;

const transactionStatusValues = ["PENDING", "CONFIRMED", "FAILED"] as const;

export const appTransactionTypeEnum = z.enum(appTransactionTypeValues);
export const appTransactionSourceEnum = z.enum(appTransactionSourceValues);
export const transactionStatusEnum = z.enum(transactionStatusValues);

export const listAppTransactionsSchema = z.object({
  tokenPublicKey: z.string().min(1).optional(),
  source: appTransactionSourceEnum.optional(),
  type: appTransactionTypeEnum.optional(),
  status: transactionStatusEnum.optional(),
  search: z.string().max(200).optional(),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(25),
});

export type ListAppTransactionsInput = z.infer<
  typeof listAppTransactionsSchema
>;

export const costBreakdownSchema = z.object({
  tokenPublicKey: z.string().min(1),
});
