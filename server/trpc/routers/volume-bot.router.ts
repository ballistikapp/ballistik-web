import {
  expensiveProtectedProcedure,
  protectedRateLimitedProcedure,
  router,
  sensitiveProcedure,
} from "../trpc";
import { volumeBotService } from "@/server/services/volume-bot.service";
import { volumeBotPresetService } from "@/server/services/volume-bot-presets.service";
import {
  closeVolumeBotAccountsSchema,
  volumeBotEligibleWalletsSchema,
  listVolumeBotSessionsSchema,
  reclaimVolumeBotSchema,
  startVolumeBotSchema,
  stopVolumeBotSchema,
  volumeBotSelectionSummarySchema,
  volumeBotStatusSchema,
  listVolumeBotPresetsSchema,
  saveVolumeBotPresetSchema,
  deleteVolumeBotPresetSchema,
} from "@/server/schemas/volume-bot.schema";

export const volumeBotRouter = router({
  start: expensiveProtectedProcedure
    .input(startVolumeBotSchema)
    .mutation(async ({ input, ctx }) => {
      return await volumeBotService.startSession(input, ctx.user.id);
    }),
  status: protectedRateLimitedProcedure
    .input(volumeBotStatusSchema)
    .query(async ({ input, ctx }) => {
      return await volumeBotService.getStatus(input, ctx.user.id);
    }),
  stop: expensiveProtectedProcedure
    .input(stopVolumeBotSchema)
    .mutation(async ({ input, ctx }) => {
      return await volumeBotService.stopSession(input.sessionId, ctx.user.id);
    }),
  reclaim: sensitiveProcedure
    .input(reclaimVolumeBotSchema)
    .mutation(async ({ input, ctx }) => {
      return await volumeBotService.reclaimFunds(input, ctx.user.id);
    }),
  closeAccounts: sensitiveProcedure
    .input(closeVolumeBotAccountsSchema)
    .mutation(async ({ input, ctx }) => {
      return await volumeBotService.closeTokenAccounts(input, ctx.user.id);
    }),
  listSessions: protectedRateLimitedProcedure
    .input(listVolumeBotSessionsSchema)
    .query(async ({ input, ctx }) => {
      return await volumeBotService.listSessions(input, ctx.user.id);
    }),
  eligibleWallets: protectedRateLimitedProcedure
    .input(volumeBotEligibleWalletsSchema)
    .query(async ({ input, ctx }) => {
      return await volumeBotService.listEligibleWallets(input, ctx.user.id);
    }),
  selectionSummary: protectedRateLimitedProcedure
    .input(volumeBotSelectionSummarySchema)
    .query(async ({ input, ctx }) => {
      return await volumeBotService.getSelectionSummary(input, ctx.user.id);
    }),
  logs: protectedRateLimitedProcedure
    .input(stopVolumeBotSchema)
    .query(async ({ input, ctx }) => {
      return await volumeBotService.getLogs(input.sessionId, ctx.user.id);
    }),
  listPresets: protectedRateLimitedProcedure
    .input(listVolumeBotPresetsSchema)
    .query(async ({ ctx }) => {
      return await volumeBotPresetService.listPresets(ctx.user.id);
    }),
  savePreset: expensiveProtectedProcedure
    .input(saveVolumeBotPresetSchema)
    .mutation(async ({ input, ctx }) => {
      return await volumeBotPresetService.savePreset(input, ctx.user.id);
    }),
  deletePreset: expensiveProtectedProcedure
    .input(deleteVolumeBotPresetSchema)
    .mutation(async ({ input, ctx }) => {
      return await volumeBotPresetService.deletePreset(input.presetId, ctx.user.id);
    }),
});
