import { router, publicProcedure } from "../trpc";
import { testService } from "@/server/services";
import { createTestSchema } from "@/server/schemas";

/**
 * Test router - Simple router for testing tRPC setup
 * Uses shared schemas from @/server/schemas for validation
 */
export const testRouter = router({
  /**
   * Get all test records
   */
  getAll: publicProcedure.query(async () => {
    return await testService.getAll();
  }),

  /**
   * Create a new test record
   * Validates input using shared createTestSchema
   */
  create: publicProcedure
    .input(createTestSchema)
    .mutation(async ({ input }) => {
      return await testService.create(input);
    }),
});
