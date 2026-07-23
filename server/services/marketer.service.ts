import "server-only";

import { prisma, Prisma } from "@/lib/prisma";
import { AppError } from "@/server/errors";
import type {
  MarketerAggregates,
  MarketerMe,
  MarketerReferralPayout,
  MarketerReferredUser,
  MarketerUpdateSetupInput,
} from "@/server/schemas/marketer.schema";
import { marketerApplicationService } from "@/server/services/marketer-application.service";

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

async function requireMarketer(userId: string) {
  const marketer = await prisma.marketer.findUnique({
    where: { userId },
    select: marketerSetupSelect,
  });

  if (!marketer) {
    return null;
  }

  return marketer;
}

async function requireEnabledMarketer(userId: string) {
  const marketer = await requireMarketer(userId);
  if (!marketer || !marketer.isEnabled) {
    return null;
  }
  return marketer;
}

export const marketerService = {
  /**
   * Referrals page / nav status for the current User.
   */
  async getMe(userId: string): Promise<MarketerMe> {
    const marketer = await requireMarketer(userId);

    if (marketer) {
      const setup = projectMarketerSetup(marketer);
      return marketer.isEnabled
        ? { status: "enabled", setup }
        : { status: "disabled", setup };
    }

    const application =
      await marketerApplicationService.getLatestForUser(userId);

    if (!application) {
      return { status: "can_apply" };
    }

    if (application.status === "PENDING") {
      return {
        status: "pending",
        application: {
          id: application.id,
          message: application.message,
          createdAt: application.createdAt,
        },
      };
    }

    if (application.status === "REJECTED") {
      return {
        status: "rejected",
        application: {
          id: application.id,
          message: application.message,
          operatorNote: application.operatorNote,
          createdAt: application.createdAt,
          updatedAt: application.updatedAt,
        },
      };
    }

    // APPROVED without a Marketer row: designation in progress — not re-apply.
    return {
      status: "pending",
      application: {
        id: application.id,
        message: application.message,
        createdAt: application.createdAt,
      },
    };
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
   * Includes light money monitoring from Referral Payouts only.
   * Readable for disabled Marketers (historical view).
   */
  async listReferredUsers(userId: string): Promise<MarketerReferredUser[]> {
    const marketer = await requireMarketer(userId);
    if (!marketer) {
      throw new AppError("Not found", 404);
    }

    const [referrals, payoutStats] = await Promise.all([
      prisma.referral.findMany({
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
      }),
      prisma.referralPayout.groupBy({
        by: ["referredUserId"],
        where: { marketerId: marketer.id },
        _sum: { marketerAmountLamports: true },
        _count: { _all: true },
        _max: { createdAt: true },
      }),
    ]);

    const statsByUserId = new Map(
      payoutStats.map((row) => [
        row.referredUserId,
        {
          totalEarnedLamports: row._sum.marketerAmountLamports ?? BigInt(0),
          lastPayoutAt: row._max.createdAt,
          payoutCount: row._count._all,
        },
      ])
    );

    return referrals.map((referral) => {
      const stats = statsByUserId.get(referral.user.id);
      return {
        referralId: referral.id,
        userId: referral.user.id,
        name: referral.user.name,
        mainWalletPublicKey: referral.user.mainWalletPublicKey,
        joinedAt: referral.createdAt,
        totalEarnedLamports: stats?.totalEarnedLamports ?? BigInt(0),
        lastPayoutAt: stats?.lastPayoutAt ?? null,
        payoutCount: stats?.payoutCount ?? 0,
      };
    });
  },

  /**
   * Referral Payouts for this Marketer, newest first.
   * Readable for disabled Marketers (historical view).
   */
  async listPayouts(userId: string): Promise<MarketerReferralPayout[]> {
    const marketer = await requireMarketer(userId);
    if (!marketer) {
      throw new AppError("Not found", 404);
    }

    const payouts = await prisma.referralPayout.findMany({
      where: { marketerId: marketer.id },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        marketerAmountLamports: true,
        platformAmountLamports: true,
        totalFeeLamports: true,
        feeShareRate: true,
        reason: true,
        txSignature: true,
        createdAt: true,
        referredUser: {
          select: {
            id: true,
            name: true,
            mainWalletPublicKey: true,
          },
        },
      },
    });

    return payouts.map((payout) => ({
      id: payout.id,
      marketerAmountLamports: payout.marketerAmountLamports,
      platformAmountLamports: payout.platformAmountLamports,
      totalFeeLamports: payout.totalFeeLamports,
      feeShareRate: Number(payout.feeShareRate),
      reason: payout.reason,
      txSignature: payout.txSignature,
      createdAt: payout.createdAt,
      referredUser: payout.referredUser,
    }));
  },

  /**
   * Light aggregates for the Marketer surface (total earned, referral count, last payout).
   * Readable for disabled Marketers (historical view).
   */
  async getAggregates(userId: string): Promise<MarketerAggregates> {
    const marketer = await requireMarketer(userId);
    if (!marketer) {
      throw new AppError("Not found", 404);
    }

    const [referralCount, payoutAgg, lastPayout] = await Promise.all([
      prisma.referral.count({ where: { marketerId: marketer.id } }),
      prisma.referralPayout.aggregate({
        where: { marketerId: marketer.id },
        _sum: { marketerAmountLamports: true },
      }),
      prisma.referralPayout.findFirst({
        where: { marketerId: marketer.id },
        orderBy: { createdAt: "desc" },
        select: { createdAt: true },
      }),
    ]);

    return {
      totalEarnedLamports: payoutAgg._sum.marketerAmountLamports ?? BigInt(0),
      referralCount,
      lastPayoutAt: lastPayout?.createdAt ?? null,
    };
  },
};
