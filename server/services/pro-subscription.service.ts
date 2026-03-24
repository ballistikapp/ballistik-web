import { prisma } from "@/lib/prisma";
import { UserPlan } from "@/lib/generated/prisma/client";
import { AppError } from "@/server/errors";
import { usageFeeService } from "@/server/services/usage-fee.service";
import { withActionLock, withIdempotency } from "@/server/security/api-abuse";

export const WEEKLY_PRO_PRICE_SOL = 0.95;
export const WEEKLY_PRO_DURATION_DAYS = 7;
const HISTORY_LIMIT = 20;

type UserPlanWriter = Pick<typeof prisma, "user">;

function addDays(date: Date, days: number) {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

export function isWeeklyProActive(
  proExpiresAt: Date | null | undefined,
  now = new Date()
) {
  return Boolean(proExpiresAt && proExpiresAt.getTime() > now.getTime());
}

export function resolveEffectiveUserPlan(
  proExpiresAt: Date | null | undefined,
  now = new Date()
) {
  return isWeeklyProActive(proExpiresAt, now) ? UserPlan.PRO : UserPlan.FREE;
}

export function resolveWeeklyProStatus(
  proExpiresAt: Date | null | undefined,
  now = new Date()
) {
  if (isWeeklyProActive(proExpiresAt, now)) {
    return "ACTIVE" as const;
  }

  return proExpiresAt ? ("EXPIRED" as const) : ("FREE" as const);
}

export async function syncUserPlanState(
  writer: UserPlanWriter,
  userId: string,
  currentPlan: UserPlan,
  proExpiresAt: Date | null | undefined,
  now = new Date()
) {
  const effectivePlan = resolveEffectiveUserPlan(proExpiresAt, now);
  if (effectivePlan !== currentPlan) {
    await writer.user.update({
      where: { id: userId },
      data: { plan: effectivePlan },
    });
  }
  return effectivePlan;
}

export const proSubscriptionService = {
  async getSubscriptionOverview(userId: string, tokenPlan: UserPlan) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        proStartedAt: true,
        proExpiresAt: true,
      },
    });

    if (!user) {
      throw new AppError("User not found", 404);
    }

    const now = new Date();
    const effectivePlan = resolveEffectiveUserPlan(user.proExpiresAt, now);
    const status = resolveWeeklyProStatus(user.proExpiresAt, now);

    return {
      plan: effectivePlan,
      tokenPlan,
      status,
      proStartedAt: user.proStartedAt,
      proExpiresAt: user.proExpiresAt,
      priceSol: WEEKLY_PRO_PRICE_SOL,
      durationDays: WEEKLY_PRO_DURATION_DAYS,
      renewalAvailable: true,
      requiresTokenRefresh: tokenPlan !== effectivePlan,
    };
  },

  async listHistory(userId: string, limit = HISTORY_LIMIT) {
    return await prisma.proSubscriptionPayment.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: Math.min(limit, HISTORY_LIMIT),
    });
  },

  async purchaseWeeklyPro(userId: string) {
    const actionKey = `billing:purchase-weekly-pro:${userId}`;
    const idempotencyKey = `billing:purchase-weekly-pro:${userId}`;

    return await withActionLock(actionKey, async () =>
      withIdempotency({
        key: idempotencyKey,
        ttlMs: 15_000,
        execute: async () => {
          const user = await prisma.user.findUnique({
            where: { id: userId },
            select: {
              id: true,
              proStartedAt: true,
              proExpiresAt: true,
            },
          });

          if (!user) {
            throw new AppError("User not found", 404);
          }

          const feeResult = await usageFeeService.collectFromMainWallet({
            userId,
            totalFeeSol: WEEKLY_PRO_PRICE_SOL,
            reason: "pro.weekly",
          });

          if (feeResult.skipped || !feeResult.signature) {
            throw new AppError("Failed to confirm Pro payment", 500);
          }

          const now = new Date();
          const startsAt = isWeeklyProActive(user.proExpiresAt, now)
            ? (user.proExpiresAt ?? now)
            : now;
          const expiresAt = addDays(startsAt, WEEKLY_PRO_DURATION_DAYS);
          const proStartedAt = isWeeklyProActive(user.proExpiresAt, now)
            ? (user.proStartedAt ?? now)
            : now;

          const result = await prisma.$transaction(async (tx) => {
            const updatedUser = await tx.user.update({
              where: { id: user.id },
              data: {
                plan: UserPlan.PRO,
                proStartedAt,
                proExpiresAt: expiresAt,
              },
              select: {
                id: true,
                plan: true,
                proStartedAt: true,
                proExpiresAt: true,
              },
            });

            const payment = await tx.proSubscriptionPayment.create({
              data: {
                userId: user.id,
                amountSol: WEEKLY_PRO_PRICE_SOL,
                txSignature: feeResult.signature,
                startsAt,
                expiresAt,
              },
              select: {
                id: true,
                amountSol: true,
                txSignature: true,
                startsAt: true,
                expiresAt: true,
                createdAt: true,
              },
            });

            return { updatedUser, payment };
          });

          return {
            plan: result.updatedUser.plan,
            proStartedAt: result.updatedUser.proStartedAt,
            proExpiresAt: result.updatedUser.proExpiresAt,
            payment: result.payment,
            fromPublicKey: feeResult.fromPublicKey,
            toPublicKey: feeResult.toPublicKey,
          };
        },
      })
    );
  },
};
