import { z } from "zod";
import { UserPlan } from "@/lib/generated/prisma/client";

export const billingOverviewSchema = z.object({});

export const billingHistorySchema = z.object({
  limit: z.number().int().min(1).max(50).default(20),
});

export const purchaseSubscriptionSchema = z.object({
  plan: z.nativeEnum(UserPlan).refine(
    (val) => val === UserPlan.DEVELOPER || val === UserPlan.PRO,
    { message: "Only DEVELOPER and PRO plans can be purchased" }
  ),
});

export type BillingOverviewInput = z.infer<typeof billingOverviewSchema>;
export type BillingHistoryInput = z.infer<typeof billingHistorySchema>;
export type PurchaseSubscriptionInput = z.infer<
  typeof purchaseSubscriptionSchema
>;
