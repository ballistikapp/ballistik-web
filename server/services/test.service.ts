import "server-only";
import { prisma } from "@/lib/prisma";
import type { CreateTestInput, TestTableOutput } from "@/server/schemas";
import { AppError } from "@/server/errors";

export const testService = {
  async getAll(): Promise<TestTableOutput[]> {
    try {
      return await prisma.testTable.findMany({
        orderBy: { createdAt: "desc" },
      });
    } catch (error) {
      throw new AppError("Failed to fetch test records", 500, { error });
    }
  },

  async create(input: CreateTestInput): Promise<TestTableOutput> {
    try {
      return await prisma.testTable.create({
        data: { name: input.name },
      });
    } catch (error) {
      throw new AppError("Failed to create test record", 500, { error });
    }
  },
};
