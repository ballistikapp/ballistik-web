import { z } from "zod";

export const createTestSchema = z.object({
  name: z.string().min(1, "Name is required").max(100, "Name is too long"),
});

export const getTestSchema = z.object({
  id: z.string().cuid(),
});

export type CreateTestInput = z.infer<typeof createTestSchema>;
export type GetTestInput = z.infer<typeof getTestSchema>;

export type TestTableOutput = {
  id: string;
  name: string;
  createdAt: Date;
};
