import { router, protectedProcedure } from "../trpc";
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
  eligibleWallets: protectedProcedure
    .input(volumeBotEligibleWalletsSchema)
    .query(async ({ input, ctx }) => {
      return await volumeBotService.listEligibleWallets(input, ctx.user.id);
    }),
  selectionSummary: protectedProcedure
    .input(volumeBotSelectionSummarySchema)
    .query(async ({ input, ctx }) => {
      return await volumeBotService.getSelectionSummary(input, ctx.user.id);
    }),
  logs: protectedProcedure
    .input(stopVolumeBotSchema)
    .query(async ({ input, ctx }) => {
      return await volumeBotService.getLogs(input.sessionId, ctx.user.id);
    }),
  listPresets: protectedProcedure
    .input(listVolumeBotPresetsSchema)
    .query(async ({ ctx }) => {
      return await volumeBotPresetService.listPresets(ctx.user.id);
    }),
  savePreset: protectedProcedure
    .input(saveVolumeBotPresetSchema)
    .mutation(async ({ input, ctx }) => {
      return await volumeBotPresetService.savePreset(input, ctx.user.id);
    }),
  deletePreset: protectedProcedure
    .input(deleteVolumeBotPresetSchema)
    .mutation(async ({ input, ctx }) => {
      return await volumeBotPresetService.deletePreset(input.presetId, ctx.user.id);
    }),
});
