import { router, protectedProcedure } from "../trpc";
import { tokenService } from "@/server/services/token.service";
import {
  createTokenSchema,
  tokenListPaginationSchema,
} from "@/server/schemas/token.schema";
import { z } from "zod";

export const tokenRouter = router({
  create: protectedProcedure
    .input(createTokenSchema)
    .mutation(async ({ input, ctx }) => {
      if (!ctx.user) {
        throw new Error("User not authenticated");
      }
      return await tokenService.createToken(input, ctx.user.id);
    }),
  getByPublicKey: protectedProcedure
    .input(z.object({ publicKey: z.string() }))
    .query(async ({ input, ctx }) => {
      return await tokenService.getTokenByPublicKey(
        input.publicKey,
        ctx.user.id
      );
    }),
  getUserTokens: protectedProcedure
    .input(tokenListPaginationSchema.optional())
    .query(async ({ ctx, input }) => {
      return await tokenService.getUserTokens(ctx.user.id, input);
    }),
  getAllUserTokens: protectedProcedure
    .input(tokenListPaginationSchema.optional())
    .query(async ({ ctx, input }) => {
      return await tokenService.getAllUserTokens(ctx.user.id, input);
    }),
});
