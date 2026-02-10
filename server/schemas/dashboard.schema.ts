import { z } from "zod";

export const getDashboardStatsSchema = z.object({
  tokenPublicKey: z.string().min(1, "Token public key is required"),
});

export type GetDashboardStatsInput = z.infer<typeof getDashboardStatsSchema>;

export const getDefiPoolsSchema = z.object({
  tokenPublicKey: z.string().min(1, "Token public key is required"),
});

export type GetDefiPoolsInput = z.infer<typeof getDefiPoolsSchema>;
