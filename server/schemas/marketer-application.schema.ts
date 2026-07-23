import { z } from "zod";
import { MARKETER_APPLICATION_MESSAGE_MAX_LENGTH } from "@/lib/config/marketer.config";

export { MARKETER_APPLICATION_MESSAGE_MAX_LENGTH };

export const marketerApplicationMessageSchema = z
  .string()
  .trim()
  .min(1, "Message is required")
  .max(
    MARKETER_APPLICATION_MESSAGE_MAX_LENGTH,
    `Message must be at most ${MARKETER_APPLICATION_MESSAGE_MAX_LENGTH} characters`
  );

export const submitMarketerApplicationSchema = z.object({
  message: marketerApplicationMessageSchema,
});

export type SubmitMarketerApplicationInput = z.infer<
  typeof submitMarketerApplicationSchema
>;

export const opsListMarketerApplicationsSchema = z.object({
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(25),
  status: z.enum(["PENDING", "APPROVED", "REJECTED"]).optional(),
  sortDir: z.enum(["asc", "desc"]).default("desc"),
});

export type OpsListMarketerApplicationsInput = z.input<
  typeof opsListMarketerApplicationsSchema
>;

export const opsGetMarketerApplicationSchema = z.object({
  applicationId: z.string().min(1),
});

export type OpsGetMarketerApplicationInput = z.infer<
  typeof opsGetMarketerApplicationSchema
>;

export const opsRejectMarketerApplicationSchema = z.object({
  applicationId: z.string().min(1),
  operatorNote: z
    .string()
    .trim()
    .max(MARKETER_APPLICATION_MESSAGE_MAX_LENGTH)
    .optional(),
});

export type OpsRejectMarketerApplicationInput = z.infer<
  typeof opsRejectMarketerApplicationSchema
>;

export type MarketerApplicationSummary = {
  id: string;
  message: string;
  operatorNote: string | null;
  status: "PENDING" | "APPROVED" | "REJECTED";
  createdAt: Date;
  updatedAt: Date;
};
