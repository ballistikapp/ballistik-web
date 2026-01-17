import { router, protectedProcedure } from "../trpc";
import { walletService } from "@/server/services/wallet.service";
import { getWalletsByTokenSchema } from "@/server/schemas/wallet.schema";

export const walletRouter = router({
  getByToken: protectedProcedure
    .input(getWalletsByTokenSchema)
    .query(async ({ input, ctx }) => {
      return await walletService.getWalletsByToken(
        input.tokenPublicKey,
        ctx.user.id
      );
    }),
});
