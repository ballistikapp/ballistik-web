import { router, protectedProcedure, sensitiveProcedure } from "../trpc";
import { creatorRewardsService } from "@/server/services/creator-rewards.service";
import {
  getCreatorRewardByTokenSchema,
  refreshCreatorRewardByTokenSchema,
  claimCreatorRewardByTokenSchema,
} from "@/server/schemas/creator-rewards.schema";

export const creatorRewardRouter = router({
  getByToken: protectedProcedure
    .input(getCreatorRewardByTokenSchema)
    .query(async ({ input, ctx }) => {
      return creatorRewardsService.getByToken(input.tokenPublicKey, ctx.user.id);
    }),

  refreshByToken: protectedProcedure
    .input(refreshCreatorRewardByTokenSchema)
    .mutation(async ({ input, ctx }) => {
      return creatorRewardsService.refreshByToken(input.tokenPublicKey, ctx.user.id);
    }),

  claimByToken: sensitiveProcedure
    .input(claimCreatorRewardByTokenSchema)
    .mutation(async ({ input, ctx }) => {
      return creatorRewardsService.claimByToken(input.tokenPublicKey, ctx.user.id);
    }),
});
