import "server-only";

import { prisma, Prisma } from "@/lib/prisma";
import { AppError } from "@/server/errors";
import type {
  MarketerReferredUser,
  MarketerUpdateSetupInput,
} from "@/server/schemas/marketer.schema";

const marketerSetupSelect = {
  id: true,
  isEnabled: true,
  referralCode: true,
  feeCollectorPublicKey: true,
} as const;

function projectMarketerSetup(marketer: {
  referralCode: string | null;
  feeCollectorPublicKey: string | null;
}) {
  return {
    referralCode: marketer.referralCode,
    feeCollectorPublicKey: marketer.feeCollectorPublicKey,
  };
}

function uniqueConstraintTargets(error: unknown): string[] {
  if (
    !(error instanceof Prisma.PrismaClientKnownRequestError) ||
    error.code !== "P2002"
  ) {
    return [];
  }
  const target = error.meta?.target;
  if (Array.isArray(target)) {
    return target.filter((value): value is string => typeof value === "string");
  }
  if (typeof target === "string") {
    return [target];
  }
  return [];
}

function referralCodeConflictMessage(error: unknown): string | null {
  const targets = uniqueConstraintTargets(error);
  if (targets.includes("referralCode")) {
    return "Referral code already in use";
  }
  return null;
}

async function requireEnabledMarketer(userId: string) {
  const marketer = await prisma.marketer.findUnique({
    where: { userId },
    select: marketerSetupSelect,
  });

  if (!marketer || !marketer.isEnabled) {
    return null;
  }

  return marketer;
}

export const marketerService = {
  /**
   * Returns the current User's enabled Marketer setup, or null when they are
   * not an enabled Marketer (nav / page gating).
   */
  async getMe(userId: string) {
    const marketer = await requireEnabledMarketer(userId);
    if (!marketer) {
      return null;
    }
    return projectMarketerSetup(marketer);
  },

  async updateSetup(userId: string, input: MarketerUpdateSetupInput) {
    const marketer = await requireEnabledMarketer(userId);
    if (!marketer) {
      throw new AppError("Not found", 404);
    }

    try {
      const updated = await prisma.marketer.update({
        where: { id: marketer.id },
        data: {
          ...(input.referralCode !== undefined
            ? { referralCode: input.referralCode }
            : {}),
          ...(input.feeCollectorPublicKey !== undefined
            ? { feeCollectorPublicKey: input.feeCollectorPublicKey }
            : {}),
        },
        select: {
          referralCode: true,
          feeCollectorPublicKey: true,
        },
      });

      return projectMarketerSetup(updated);
    } catch (error) {
      const message = referralCodeConflictMessage(error);
      if (message) {
        throw new AppError(message, 400);
      }
      throw error;
    }
  },

  /**
   * Users attributed to this Marketer (sticky Referrals), newest first.
   */
  async listReferredUsers(userId: string): Promise<MarketerReferredUser[]> {
    const marketer = await requireEnabledMarketer(userId);
    if (!marketer) {
      throw new AppError("Not found", 404);
    }

    const referrals = await prisma.referral.findMany({
      where: { marketerId: marketer.id },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        createdAt: true,
        user: {
          select: {
            id: true,
            name: true,
            mainWalletPublicKey: true,
          },
        },
      },
    });

    return referrals.map((referral) => ({
      referralId: referral.id,
      userId: referral.user.id,
      name: referral.user.name,
      mainWalletPublicKey: referral.user.mainWalletPublicKey,
      joinedAt: referral.createdAt,
    }));
  },
};
