import { prisma } from "@/lib/prisma";
import type { CreateTestInput, TestTableOutput } from "@/server/schemas";

/**
 * Test service - Simple service for testing tRPC setup
 * Uses types from shared schemas for type safety
 */
export const testService = {
  /**
   * Get all test records
   */
  async getAll(): Promise<TestTableOutput[]> {
    return await prisma.testTable.findMany({
      orderBy: { createdAt: "desc" },
    });
  },

  /**
   * Create a new test record
   * @param input - Validated input matching CreateTestInput type
   */
  async create(input: CreateTestInput): Promise<TestTableOutput> {
    return await prisma.testTable.create({
      data: { name: input.name },
    });
  },
};
