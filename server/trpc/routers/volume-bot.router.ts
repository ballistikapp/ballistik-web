import { router, protectedProcedure } from "../trpc";
import { volumeBotService } from "@/server/services/volume-bot.service";
import {
  closeVolumeBotAccountsSchema,
  listVolumeBotSessionsSchema,
  reclaimVolumeBotSchema,
  startVolumeBotSchema,
  stopVolumeBotSchema,
  volumeBotStatusSchema,
} from "@/server/schemas/volume-bot.schema";

export const volumeBotRouter = router({
  start: protectedProcedure
    .input(startVolumeBotSchema)
    .mutation(async ({ input, ctx }) => {
      return await volumeBotService.startSession(input, ctx.user.id);
    }),
  status: protectedProcedure
    .input(volumeBotStatusSchema)
    .query(async ({ input, ctx }) => {
      return await volumeBotService.getStatus(input, ctx.user.id);
    }),
  stop: protectedProcedure
    .input(stopVolumeBotSchema)
    .mutation(async ({ input, ctx }) => {
      return await volumeBotService.stopSession(input.sessionId, ctx.user.id);
    }),
  reclaim: protectedProcedure
    .input(reclaimVolumeBotSchema)
    .mutation(async ({ input, ctx }) => {
      return await volumeBotService.reclaimFunds(input, ctx.user.id);
    }),
  closeAccounts: protectedProcedure
    .input(closeVolumeBotAccountsSchema)
    .mutation(async ({ input, ctx }) => {
      return await volumeBotService.closeTokenAccounts(input, ctx.user.id);
    }),
  listSessions: protectedProcedure
    .input(listVolumeBotSessionsSchema)
    .query(async ({ input, ctx }) => {
      return await volumeBotService.listSessions(input, ctx.user.id);
    }),
});
