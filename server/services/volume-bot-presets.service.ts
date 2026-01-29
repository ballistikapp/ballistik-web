import { prisma } from "@/lib/prisma";
import { AppError } from "@/server/errors";
import type {
  SaveVolumeBotPresetInput,
} from "@/server/schemas/volume-bot.schema";

export const volumeBotPresetService = {
  async listPresets(userId: string) {
    return await prisma.volumeBotPreset.findMany({
      where: { userId },
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        name: true,
        config: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  },

  async savePreset(input: SaveVolumeBotPresetInput, userId: string) {
    const name = input.name.trim();
    if (!name) {
      throw new AppError("Preset name required", 400);
    }
    return await prisma.volumeBotPreset.upsert({
      where: { userId_name: { userId, name } },
      update: {
        config: input.config,
      },
      create: {
        userId,
        name,
        config: input.config,
      },
      select: {
        id: true,
        name: true,
        config: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  },

  async deletePreset(presetId: string, userId: string) {
    const preset = await prisma.volumeBotPreset.findFirst({
      where: { id: presetId, userId },
      select: { id: true },
    });
    if (!preset) {
      throw new AppError("Preset not found", 404);
    }
    await prisma.volumeBotPreset.delete({ where: { id: presetId } });
    return { success: true };
  },
};
