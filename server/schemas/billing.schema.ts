import { z } from "zod";

export const billingOverviewSchema = z.object({});

export const billingHistorySchema = z.object({
  limit: z.number().int().min(1).max(50).default(20),
});

export const purchaseWeeklyProSchema = z.object({});

export type BillingOverviewInput = z.infer<typeof billingOverviewSchema>;
export type BillingHistoryInput = z.infer<typeof billingHistorySchema>;
export type PurchaseWeeklyProInput = z.infer<typeof purchaseWeeklyProSchema>;
