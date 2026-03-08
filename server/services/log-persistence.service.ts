import type { Prisma } from "@/lib/generated/prisma/client";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

export async function persistLaunchLog(
  data: Prisma.LaunchLogUncheckedCreateInput
): Promise<boolean> {
  try {
    await prisma.launchLog.create({ data });
    return true;
  } catch (error) {
    logger.warn("Failed to persist launch log", {
      launchId: data.launchId,
      step: data.step ?? null,
      level: data.level,
      errorMessage: toErrorMessage(error),
    });
    return false;
  }
}

export async function persistHoldingExitLog(
  data: Prisma.HoldingExitLogUncheckedCreateInput
): Promise<boolean> {
  try {
    await prisma.holdingExitLog.create({ data });
    return true;
  } catch (error) {
    logger.warn("Failed to persist holding exit log", {
      exitId: data.exitId,
      step: data.step ?? null,
      level: data.level,
      errorMessage: toErrorMessage(error),
    });
    return false;
  }
}

export async function persistVolumeBotLog(
  data: Prisma.VolumeBotLogUncheckedCreateInput
): Promise<boolean> {
  try {
    await prisma.volumeBotLog.create({ data });
    return true;
  } catch (error) {
    logger.warn("Failed to persist volume bot log", {
      sessionId: data.sessionId,
      type: data.type,
      level: data.level,
      walletPublicKey: data.walletPublicKey ?? null,
      errorMessage: toErrorMessage(error),
    });
    return false;
  }
}
