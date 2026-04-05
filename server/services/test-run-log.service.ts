import "server-only";
import {
  appendTestRunLogEvent,
  getTestRunLoggingState,
  type TestRunLogEventInput,
} from "@/lib/test-run-log";
import { prisma } from "@/lib/prisma";
import { AppError } from "@/server/errors";
import type { AppendTestRunLogEventInput } from "@/server/schemas/test-run-log.schema";

export const testRunLogService = {
  getConfig() {
    return getTestRunLoggingState();
  },

  async appendServerEvent(event: TestRunLogEventInput & { userId?: string }) {
    return await appendTestRunLogEvent(event);
  },

  async appendClientEvent(input: AppendTestRunLogEventInput, userId: string) {
    if (input.tokenPublicKey) {
      const token = await prisma.token.findFirst({
        where: {
          publicKey: input.tokenPublicKey,
          userId,
        },
        select: { publicKey: true },
      });
      if (!token) {
        throw new AppError("Token not found", 404);
      }
    }
    return await appendTestRunLogEvent({
      ...input,
      source: input.source ?? "client",
      userId,
    });
  },
};
