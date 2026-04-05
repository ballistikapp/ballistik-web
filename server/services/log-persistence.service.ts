import "server-only";
import type { Prisma } from "@/lib/generated/prisma/client";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { testRunLogService } from "@/server/services/test-run-log.service";

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
    await testRunLogService.appendServerEvent({
      eventType: "launch_step",
      source: "launch-log",
      launchId: data.launchId,
      action: data.step ?? data.message,
      status: data.level,
      actualValue: data.data ?? null,
      notes: data.message,
    });
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
    await testRunLogService.appendServerEvent({
      eventType: "wallet_transaction",
      source: "holding-exit-log",
      action: data.step ?? data.message,
      status: data.level,
      actualValue: data.data ?? null,
      notes: data.message,
    });
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
    await testRunLogService.appendServerEvent({
      eventType: "volume_bot_event",
      source: "volume-bot-log",
      sessionId: data.sessionId,
      action: data.type,
      status: data.level,
      signature: data.signature ?? undefined,
      wallets: data.walletPublicKey ? [data.walletPublicKey] : [],
      actualValue: data.data ?? null,
      notes: data.message,
    });
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
